import { z } from 'zod';

/**
 * An agent run and the steps inside it.
 *
 * A run is the unit the dashboard reports on: one natural-language request carried through
 * retrieval, validation, human approval and execution. Steps are recorded rather than inferred,
 * so a run that failed halfway is as legible as one that completed.
 */

export const StepName = z.enum(['retrieve', 'validate', 'approve', 'execute']);
export type StepName = z.infer<typeof StepName>;

export const StepStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'awaiting_human', 'skipped']);
export type StepStatus = z.infer<typeof StepStatus>;

export const RunStatus = z.enum(['running', 'awaiting_approval', 'succeeded', 'failed', 'rejected']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunStep = z.object({
  name: StepName,
  status: StepStatus,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  /** Step output, shaped per step. Rendered as JSON in the run timeline. */
  output: z.unknown().nullable(),
  error: z.string().nullable()
});
export type RunStep = z.infer<typeof RunStep>;

export const RunEvent = z.object({
  id: z.number().int(),
  runId: z.string(),
  at: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  step: StepName.nullable(),
  message: z.string()
});
export type RunEvent = z.infer<typeof RunEvent>;

export const Run = z.object({
  id: z.string(),
  request: z.string(),
  status: RunStatus,
  policyId: z.string().nullable(),
  steps: z.array(RunStep),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  /** Set once a human decides. Null while the run has not reached the checkpoint. */
  decision: z
    .object({ by: z.string(), at: z.string(), approved: z.boolean(), note: z.string() })
    .nullable()
});
export type Run = z.infer<typeof Run>;

export const AuditEntry = z.object({
  id: z.number().int(),
  at: z.string(),
  runId: z.string(),
  policyId: z.string(),
  policyName: z.string(),
  policyVersion: z.number().int(),
  action: z.enum(['activated', 'rejected', 'superseded']),
  actor: z.string(),
  note: z.string(),
  /** Where the immutable copy went, when archival is configured. */
  archivedTo: z.string().nullable()
});
export type AuditEntry = z.infer<typeof AuditEntry>;
