import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { PolicyDraft } from '@aga/shared';
import type { LlmProvider, ReviewFinding } from './types.js';

const MODEL = process.env.LLM_MODEL ?? 'claude-opus-5';

const DRAFTING_SYSTEM = `You convert natural-language AI governance requests into structured policy definitions.

Rules:
- Every policy needs at least one rule. A rule's subject is a dotted attribute path the runtime can
  evaluate, such as prompt.contains_pii, model.provider, or output.destination.
- Prefer deny and require over allow. Governance policies describe constraints, not permissions.
- Set severity from the consequence of a violation, not the tone of the request.
- Populate references only with regulations or frameworks the request actually names. Do not invent
  citations — an unsupported reference is worse than none.
- If the request is vague about scope, default to production and say so in the description.`;

const ReviewFindings = z.object({
  findings: z.array(
    z.object({
      severity: z.enum(['info', 'warning', 'blocker']),
      message: z.string()
    })
  )
});

export class ClaudeProvider implements LlmProvider {
  readonly name = `claude (${MODEL})`;
  private client = new Anthropic();

  async draftPolicy(request: string): Promise<PolicyDraft> {
    const response = await this.client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: DRAFTING_SYSTEM,
      messages: [{ role: 'user', content: request }],
      output_config: { format: zodOutputFormat(PolicyDraft) }
    });

    // parsed_output is null when the response failed to satisfy the schema. Surfacing that as an
    // error keeps a malformed draft out of the workflow rather than half-populating a policy.
    if (!response.parsed_output) {
      throw new Error('Model response did not match the policy schema');
    }
    return response.parsed_output;
  }

  async reviewDraft(draft: PolicyDraft, existing: PolicyDraft[]): Promise<ReviewFinding[]> {
    const response = await this.client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Adaptive thinking: conflict detection across an existing policy set is exactly the kind of
      // comparison that benefits from the model reasoning before it answers.
      thinking: { type: 'adaptive' },
      system:
        'You review a proposed AI governance policy against the policies already in force. ' +
        'Report contradictions, overlaps that make enforcement ambiguous, and gaps in scope. ' +
        'Use severity "blocker" only when activating the draft would contradict an active policy.',
      messages: [
        {
          role: 'user',
          content: [
            'Proposed policy:',
            JSON.stringify(draft, null, 2),
            '',
            'Policies already in force:',
            existing.length ? JSON.stringify(existing, null, 2) : '(none)'
          ].join('\n')
        }
      ],
      output_config: { format: zodOutputFormat(ReviewFindings) }
    });

    return response.parsed_output?.findings ?? [];
  }
}
