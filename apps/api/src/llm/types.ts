import type { PolicyDraft } from '@aga/shared';

/**
 * The surface the agent depends on. Two implementations satisfy it: Claude, and a deterministic
 * mock used when no API key is present. The orchestrator is written against this interface so the
 * whole workflow — including its tests — runs without network access.
 */
export interface LlmProvider {
  readonly name: string;

  /** Turn a natural-language governance request into a structured policy draft. */
  draftPolicy(request: string): Promise<PolicyDraft>;

  /**
   * Review a draft against the policies already in force. Returns findings rather than a verdict:
   * the decision to block belongs to the validation step, which applies deterministic rules on top.
   */
  reviewDraft(draft: PolicyDraft, existing: PolicyDraft[]): Promise<ReviewFinding[]>;
}

export interface ReviewFinding {
  severity: 'info' | 'warning' | 'blocker';
  message: string;
}
