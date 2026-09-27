import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry, Policy, Run, RunEvent, RunStep } from '@aga/shared';

const path = process.env.DATABASE_PATH ?? './data/governance.db';
mkdirSync(dirname(path), { recursive: true });

// Not exported: every caller goes through the typed helpers below, which keeps SQL in one file
// and avoids leaking the driver's types through the package's declaration output.
const db = new Database(path);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY, version INTEGER NOT NULL, status TEXT NOT NULL,
    name TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL,
    owner TEXT NOT NULL, scope TEXT NOT NULL, rules TEXT NOT NULL, refs TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, request TEXT NOT NULL, status TEXT NOT NULL,
    policy_id TEXT, steps TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
    error TEXT, decision TEXT
  );

  CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL,
    level TEXT NOT NULL, step TEXT, message TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, run_id TEXT NOT NULL,
    policy_id TEXT NOT NULL, policy_name TEXT NOT NULL, policy_version INTEGER NOT NULL,
    action TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL, archived_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id);
  CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
`);

const ms = (from: string, to: string | null) =>
  to ? new Date(to).getTime() - new Date(from).getTime() : null;

/* ---------- policies ---------- */

type PolicyRow = Record<string, any>;

const toPolicy = (r: PolicyRow): Policy => ({
  id: r.id,
  version: r.version,
  status: r.status,
  name: r.name,
  description: r.description,
  severity: r.severity,
  owner: r.owner,
  scope: JSON.parse(r.scope),
  rules: JSON.parse(r.rules),
  references: JSON.parse(r.refs),
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

export const policies = {
  upsert(p: Policy): void {
    db.prepare(
      `INSERT INTO policies (id, version, status, name, description, severity, owner, scope, rules, refs, created_at, updated_at)
       VALUES (@id, @version, @status, @name, @description, @severity, @owner, @scope, @rules, @refs, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         version=@version, status=@status, name=@name, description=@description, severity=@severity,
         owner=@owner, scope=@scope, rules=@rules, refs=@refs, updated_at=@updatedAt`
    ).run({
      ...p,
      scope: JSON.stringify(p.scope),
      rules: JSON.stringify(p.rules),
      refs: JSON.stringify(p.references)
    });
  },

  get(id: string): Policy | null {
    const row = db.prepare('SELECT * FROM policies WHERE id = ?').get(id) as PolicyRow | undefined;
    return row ? toPolicy(row) : null;
  },

  list(status?: string): Policy[] {
    const rows = status
      ? db.prepare('SELECT * FROM policies WHERE status = ? ORDER BY updated_at DESC').all(status)
      : db.prepare('SELECT * FROM policies ORDER BY updated_at DESC').all();
    return (rows as PolicyRow[]).map(toPolicy);
  }
};

/* ---------- runs ---------- */

const toRun = (r: PolicyRow): Run => ({
  id: r.id,
  request: r.request,
  status: r.status,
  policyId: r.policy_id,
  steps: JSON.parse(r.steps),
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationMs: ms(r.started_at, r.ended_at),
  error: r.error,
  decision: r.decision ? JSON.parse(r.decision) : null
});

export const runs = {
  create(run: Run): void {
    db.prepare(
      `INSERT INTO runs (id, request, status, policy_id, steps, started_at, ended_at, error, decision)
       VALUES (@id, @request, @status, @policyId, @steps, @startedAt, @endedAt, @error, @decision)`
    ).run({
      ...run,
      steps: JSON.stringify(run.steps),
      decision: run.decision ? JSON.stringify(run.decision) : null
    });
  },

  save(run: Run): void {
    db.prepare(
      `UPDATE runs SET request=@request, status=@status, policy_id=@policyId, steps=@steps,
       ended_at=@endedAt, error=@error, decision=@decision WHERE id=@id`
    ).run({
      ...run,
      steps: JSON.stringify(run.steps),
      decision: run.decision ? JSON.stringify(run.decision) : null
    });
  },

  get(id: string): Run | null {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as PolicyRow | undefined;
    return row ? toRun(row) : null;
  },

  list(limit = 50): Run[] {
    const rows = db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit);
    return (rows as PolicyRow[]).map(toRun);
  }
};

/* ---------- events & audit ---------- */

export const events = {
  add(runId: string, level: RunEvent['level'], step: RunEvent['step'], message: string): RunEvent {
    const at = new Date().toISOString();
    const info = db
      .prepare('INSERT INTO run_events (run_id, at, level, step, message) VALUES (?, ?, ?, ?, ?)')
      .run(runId, at, level, step, message);
    return { id: Number(info.lastInsertRowid), runId, at, level, step, message };
  },

  forRun(runId: string): RunEvent[] {
    const rows = db.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY id').all(runId);
    return (rows as PolicyRow[]).map((r) => ({
      id: r.id, runId: r.run_id, at: r.at, level: r.level, step: r.step, message: r.message
    }));
  },

  recent(limit = 100): RunEvent[] {
    const rows = db.prepare('SELECT * FROM run_events ORDER BY id DESC LIMIT ?').all(limit);
    return (rows as PolicyRow[]).map((r) => ({
      id: r.id, runId: r.run_id, at: r.at, level: r.level, step: r.step, message: r.message
    }));
  }
};

export const audit = {
  add(entry: Omit<AuditEntry, 'id'>): void {
    db.prepare(
      `INSERT INTO audit (at, run_id, policy_id, policy_name, policy_version, action, actor, note, archived_to)
       VALUES (@at, @runId, @policyId, @policyName, @policyVersion, @action, @actor, @note, @archivedTo)`
    ).run(entry);
  },

  list(limit = 100): AuditEntry[] {
    const rows = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit);
    return (rows as PolicyRow[]).map((r) => ({
      id: r.id, at: r.at, runId: r.run_id, policyId: r.policy_id, policyName: r.policy_name,
      policyVersion: r.policy_version, action: r.action, actor: r.actor, note: r.note,
      archivedTo: r.archived_to
    }));
  }
};

export const emptySteps = (): RunStep[] =>
  (['retrieve', 'validate', 'approve', 'execute'] as const).map((name) => ({
    name, status: 'pending', startedAt: null, endedAt: null, durationMs: null, output: null, error: null
  }));
