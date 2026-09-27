import { nanoid } from 'nanoid';
import type { Policy, Run, RunStep, StepName } from '@aga/shared';
import { audit, emptySteps, events, policies, runs } from '../db.js';
import { archiveAuditEntry, archiveEnabled } from '../aws/audit-archive.js';
import { createProvider } from '../llm/index.js';

/**
 * The agent workflow: retrieve, validate, approve, execute.
 *
 * Two properties matter more than the steps themselves.
 *
 * It is resumable. The approval step is a genuine stop: the run is persisted with status
 * `awaiting_approval` and the process keeps no in-memory continuation. A decision arriving minutes
 * or days later, after a restart or from a different instance, picks the run up from the database
 * and continues. That is what makes the checkpoint a control rather than a prompt.
 *
 * It is observable by construction. Every step transition and every notable fact is written to the
 * run's event log as it happens, so a run that failed halfway is as legible as one that completed.
 * The dashboard reads that log rather than reconstructing history from outcomes.
 */

const llm = createProvider();

type Subscriber = (event: { type: string; run: Run }) => void;
const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(runId: string, fn: Subscriber): () => void {
  const set = subscribers.get(runId) ?? new Set<Subscriber>();
  set.add(fn);
  subscribers.set(runId, set);
  return () => {
    set.delete(fn);
  };
}

function publish(run: Run, type: string): void {
  for (const fn of subscribers.get(run.id) ?? []) fn({ type, run });
}

/** End a run. Keeps endedAt and durationMs in step, including on the object returned to callers. */
function endRun(run: Run, status: Run['status'], at = new Date().toISOString()): void {
  run.status = status;
  run.endedAt = at;
  run.durationMs = Date.parse(at) - Date.parse(run.startedAt);
}

function step(run: Run, name: StepName): RunStep {
  const found = run.steps.find((s) => s.name === name);
  if (!found) throw new Error(`Run ${run.id} has no step "${name}"`);
  return found;
}

function begin(run: Run, name: StepName): void {
  const s = step(run, name);
  s.status = 'running';
  s.startedAt = new Date().toISOString();
  runs.save(run);
  publish(run, 'step:start');
}

function finish(run: Run, name: StepName, output: unknown): void {
  const s = step(run, name);
  s.status = 'succeeded';
  s.endedAt = new Date().toISOString();
  s.durationMs = s.startedAt ? Date.parse(s.endedAt) - Date.parse(s.startedAt) : null;
  s.output = output;
  runs.save(run);
  publish(run, 'step:end');
}

function fail(run: Run, name: StepName, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const s = step(run, name);
  s.status = 'failed';
  s.endedAt = new Date().toISOString();
  s.durationMs = s.startedAt ? Date.parse(s.endedAt) - Date.parse(s.startedAt) : null;
  s.error = message;

  run.error = message;
  endRun(run, 'failed', s.endedAt);
  for (const other of run.steps) {
    if (other.status === 'pending') other.status = 'skipped';
  }

  events.add(run.id, 'error', name, message);
  runs.save(run);
  publish(run, 'run:failed');
}

/** Start a run from a natural-language request. Resolves when the run reaches its first stop. */
export async function startRun(request: string, owner: string): Promise<Run> {
  const run: Run = {
    id: nanoid(10),
    request,
    status: 'running',
    policyId: null,
    steps: emptySteps(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    error: null,
    decision: null
  };

  runs.create(run);
  events.add(run.id, 'info', null, `Run started by ${owner} using ${llm.name}`);
  publish(run, 'run:start');

  // -- retrieve ---------------------------------------------------------------------------------
  let active: Policy[] = [];
  try {
    begin(run, 'retrieve');
    active = policies.list('active');

    const needle = request.toLowerCase();
    const related = active.filter((p) =>
      p.rules.some((r) => {
        const attribute = r.subject.split('.')[1];
        return attribute ? needle.includes(attribute.replace(/_/g, ' ')) : false;
      })
    );

    events.add(
      run.id,
      'info',
      'retrieve',
      `${active.length} active ${active.length === 1 ? 'policy' : 'policies'} in force, ` +
        `${related.length} related to this request`
    );
    finish(run, 'retrieve', { activeCount: active.length, related: related.map((p) => p.name) });
  } catch (err) {
    fail(run, 'retrieve', err);
    return run;
  }

  // -- validate ---------------------------------------------------------------------------------
  let draft: Policy;
  try {
    begin(run, 'validate');

    const drafted = await llm.draftPolicy(request);
    events.add(
      run.id,
      'info',
      'validate',
      `Drafted "${drafted.name}" with ${drafted.rules.length} rule(s), severity ${drafted.severity}`
    );

    const findings = await llm.reviewDraft(drafted, active);
    for (const f of findings) {
      events.add(run.id, f.severity === 'blocker' ? 'error' : 'warn', 'validate', f.message);
    }

    const blockers = findings.filter((f) => f.severity === 'blocker');
    if (blockers.length) {
      throw new Error(
        `Validation blocked by ${blockers.length} conflict(s) with active policy. ${blockers[0]!.message}`
      );
    }

    const now = new Date().toISOString();
    draft = {
      ...drafted,
      id: nanoid(8),
      version: 1,
      status: 'awaiting_approval',
      owner,
      createdAt: now,
      updatedAt: now
    };
    policies.upsert(draft);
    run.policyId = draft.id;

    finish(run, 'validate', { policyId: draft.id, findings });
  } catch (err) {
    fail(run, 'validate', err);
    return run;
  }

  // -- approve (human checkpoint) ----------------------------------------------------------------
  // The run stops here. No timer, no auto-approval, no continuation held in memory.
  begin(run, 'approve');
  step(run, 'approve').status = 'awaiting_human';
  run.status = 'awaiting_approval';
  events.add(run.id, 'info', 'approve', 'Waiting for human approval before the policy takes effect');
  runs.save(run);
  publish(run, 'run:awaiting_approval');

  return run;
}

/** Resume a paused run with a human decision. Rejecting ends the run without executing. */
export async function decide(
  runId: string,
  approved: boolean,
  reviewer: string,
  note: string
): Promise<Run> {
  const run = runs.get(runId);
  if (!run) throw new Error(`No run ${runId}`);
  if (run.status !== 'awaiting_approval') {
    throw new Error(`Run ${runId} is ${run.status}, not awaiting approval`);
  }

  const at = new Date().toISOString();
  run.decision = { by: reviewer, at, approved, note };

  const approveStep = step(run, 'approve');
  approveStep.status = 'succeeded';
  approveStep.endedAt = at;
  approveStep.durationMs = approveStep.startedAt
    ? Date.parse(at) - Date.parse(approveStep.startedAt)
    : null;
  approveStep.output = { approved, reviewer, note };

  const policy = run.policyId ? policies.get(run.policyId) : null;
  if (!policy) {
    fail(run, 'approve', 'Approved run has no policy attached');
    return run;
  }

  if (!approved) {
    policy.status = 'rejected';
    policy.updatedAt = at;
    policies.upsert(policy);

    step(run, 'execute').status = 'skipped';
    endRun(run, 'rejected', at);

    events.add(run.id, 'warn', 'approve', `Rejected by ${reviewer}: ${note || 'no reason given'}`);
    audit.add({
      at,
      runId: run.id,
      policyId: policy.id,
      policyName: policy.name,
      policyVersion: policy.version,
      action: 'rejected',
      actor: reviewer,
      note,
      archivedTo: null
    });

    runs.save(run);
    publish(run, 'run:rejected');
    return run;
  }

  events.add(run.id, 'info', 'approve', `Approved by ${reviewer}`);
  runs.save(run);
  publish(run, 'step:end');

  // -- execute -----------------------------------------------------------------------------------
  try {
    begin(run, 'execute');

    // Activating a policy supersedes any active policy sharing its name. That is the versioning
    // path: a governance policy is amended, not duplicated.
    const superseded = policies
      .list('active')
      .filter((p) => p.name === policy.name && p.id !== policy.id);

    for (const old of superseded) {
      old.status = 'archived';
      old.updatedAt = at;
      policies.upsert(old);
      events.add(run.id, 'info', 'execute', `Superseded "${old.name}" v${old.version}`);
      audit.add({
        at,
        runId: run.id,
        policyId: old.id,
        policyName: old.name,
        policyVersion: old.version,
        action: 'superseded',
        actor: reviewer,
        note: `Replaced by ${policy.id}`,
        archivedTo: null
      });
    }

    policy.version = superseded.length ? Math.max(...superseded.map((p) => p.version)) + 1 : 1;
    policy.status = 'active';
    policy.updatedAt = at;
    policies.upsert(policy);

    const entry = {
      at,
      runId: run.id,
      policyId: policy.id,
      policyName: policy.name,
      policyVersion: policy.version,
      action: 'activated' as const,
      actor: reviewer,
      note,
      archivedTo: null as string | null
    };

    entry.archivedTo = await archiveAuditEntry(entry);
    events.add(
      run.id,
      'info',
      'execute',
      entry.archivedTo
        ? `Audit record archived to ${entry.archivedTo}`
        : 'Archival skipped, AUDIT_ARCHIVE_BUCKET is not configured'
    );
    audit.add(entry);

    finish(run, 'execute', {
      policyId: policy.id,
      version: policy.version,
      superseded: superseded.length,
      archived: archiveEnabled
    });

    endRun(run, 'succeeded');
    events.add(run.id, 'info', null, `Policy "${policy.name}" v${policy.version} is now active`);
    runs.save(run);
    publish(run, 'run:succeeded');
  } catch (err) {
    fail(run, 'execute', err);
  }

  return run;
}
