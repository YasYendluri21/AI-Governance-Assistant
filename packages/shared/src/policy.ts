import { z } from 'zod';

/**
 * The structured form of a governance policy.
 *
 * This schema is the contract between three things: what the model is asked to produce from a
 * natural-language request, what the validation step checks, and what the UI renders. Keeping one
 * definition means a change to the policy shape cannot drift between them.
 */

export const RuleEffect = z.enum(['allow', 'deny', 'require']);
export type RuleEffect = z.infer<typeof RuleEffect>;

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const PolicyStatus = z.enum(['draft', 'awaiting_approval', 'active', 'rejected', 'archived']);
export type PolicyStatus = z.infer<typeof PolicyStatus>;

export const PolicyRule = z.object({
  /** What the rule acts on, e.g. "prompt.contains_pii" or "model.provider". */
  subject: z.string().min(1),
  effect: RuleEffect,
  /** Human-readable condition, e.g. "classification is restricted". */
  condition: z.string().min(1),
  /** Why the rule exists. Carried into the audit record so reviewers see intent, not just logic. */
  rationale: z.string().default('')
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyScope = z.object({
  /** Model identifiers the policy governs. "*" means all. */
  models: z.array(z.string()).default(['*']),
  /** Data classifications in scope, e.g. "pii", "phi", "public". */
  dataClasses: z.array(z.string()).default([]),
  /** Deployment environments, e.g. "production", "staging". */
  environments: z.array(z.string()).default(['production'])
});
export type PolicyScope = z.infer<typeof PolicyScope>;

/**
 * What the model is asked to extract from a natural-language request. Deliberately excludes
 * anything the system owns — id, version, status, timestamps — so the model cannot invent them.
 */
export const PolicyDraft = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  scope: PolicyScope,
  rules: z.array(PolicyRule).min(1),
  severity: Severity,
  /** Regulation or framework the policy maps to, e.g. "EU AI Act Art. 10". Empty when none. */
  references: z.array(z.string()).default([])
});
export type PolicyDraft = z.infer<typeof PolicyDraft>;

export const Policy = PolicyDraft.extend({
  id: z.string(),
  version: z.number().int().positive(),
  status: PolicyStatus,
  owner: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Policy = z.infer<typeof Policy>;
