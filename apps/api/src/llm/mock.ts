import type { PolicyDraft, Severity } from '@aga/shared';
import type { LlmProvider, ReviewFinding } from './types.js';

/**
 * A deterministic stand-in for the model, so the repository runs with no API key and no network.
 *
 * It is keyword-driven rather than clever — the point is that every other part of the system
 * (orchestration, checkpoints, persistence, the dashboard) can be exercised end to end, including
 * in tests, without the variance of a live model.
 */

const DATA_CLASSES: Array<[RegExp, string]> = [
  [/\bpii\b|personal data|personally identifiable/i, 'pii'],
  [/\bphi\b|health|medical|hipaa/i, 'phi'],
  [/\bpci\b|card number|payment data/i, 'pci'],
  [/source code|proprietary code|repository/i, 'source-code'],
  [/customer data|client data/i, 'customer-data']
];

const ENVIRONMENTS: Array<[RegExp, string]> = [
  [/\bproduction\b|\bprod\b/i, 'production'],
  [/\bstaging\b/i, 'staging'],
  [/\bdevelopment\b|\bdev\b/i, 'development']
];

function severityFor(request: string): Severity {
  if (/\bnever\b|\bprohibit|\bmust not\b|\bban\b|critical/i.test(request)) return 'critical';
  if (/\brequire|\bmust\b|\bblock\b/i.test(request)) return 'high';
  if (/\bshould\b|\bprefer\b/i.test(request)) return 'medium';
  return 'low';
}

function matches(pairs: Array<[RegExp, string]>, request: string): string[] {
  return pairs.filter(([re]) => re.test(request)).map(([, value]) => value);
}

/**
 * Name a policy after its first sentence rather than a fixed word count, which used to cut names
 * mid-phrase. Long sentences are trimmed on a word boundary so the name still reads as a clause.
 */
function nameFrom(request: string): string {
  const sentence = request.trim().split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, '').trim() ?? '';
  if (!sentence) return 'Untitled policy';

  const name = sentence.length <= 80 ? sentence : `${sentence.slice(0, sentence.lastIndexOf(' ', 80))}…`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export class MockProvider implements LlmProvider {
  readonly name = 'mock (deterministic, no API key)';

  async draftPolicy(request: string): Promise<PolicyDraft> {
    const dataClasses = matches(DATA_CLASSES, request);
    const environments = matches(ENVIRONMENTS, request);
    const prohibits = /\bnot\b|\bnever\b|\bprohibit|\bban\b|\bblock\b|\bdeny\b/i.test(request);

    const rules: PolicyDraft['rules'] = [];

    if (dataClasses.length) {
      rules.push({
        subject: 'prompt.data_classification',
        effect: prohibits ? 'deny' : 'require',
        condition: `classification is one of: ${dataClasses.join(', ')}`,
        rationale: 'Derived from the data categories named in the request.'
      });
    }

    if (/\bapprov|\breview\b|\bsign.?off\b/i.test(request)) {
      rules.push({
        subject: 'workflow.human_review',
        effect: 'require',
        condition: 'a named reviewer approves before the action proceeds',
        rationale: 'The request asks for human oversight.'
      });
    }

    if (/\blog\b|\baudit\b|\btrace/i.test(request)) {
      rules.push({
        subject: 'telemetry.audit_log',
        effect: 'require',
        condition: 'the interaction is written to the immutable audit log',
        rationale: 'The request asks for an auditable record.'
      });
    }

    if (/external|third.?party|vendor|public model/i.test(request)) {
      rules.push({
        subject: 'model.provider',
        effect: prohibits ? 'deny' : 'allow',
        condition: 'the model is hosted outside the organisation boundary',
        rationale: 'The request distinguishes internal from external model hosting.'
      });
    }

    if (!rules.length) {
      rules.push({
        subject: 'request.intent',
        effect: prohibits ? 'deny' : 'require',
        condition: request.trim().slice(0, 140),
        rationale: 'No structured attribute matched; the request is carried verbatim for review.'
      });
    }

    return {
      name: nameFrom(request),
      description: request.trim(),
      scope: {
        models: ['*'],
        dataClasses,
        environments: environments.length ? environments : ['production']
      },
      rules,
      severity: severityFor(request),
      references: []
    };
  }

  async reviewDraft(draft: PolicyDraft, existing: PolicyDraft[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const other of existing) {
      for (const rule of draft.rules) {
        const clash = other.rules.find(
          (r) => r.subject === rule.subject && r.effect !== rule.effect
        );
        if (clash) {
          findings.push({
            severity: 'blocker',
            message: `"${other.name}" already sets ${rule.subject} to "${clash.effect}"; this draft sets it to "${rule.effect}".`
          });
        }
      }
    }

    if (!draft.scope.dataClasses.length) {
      findings.push({
        severity: 'warning',
        message: 'No data classification in scope — the policy applies to every request in its environments.'
      });
    }

    if (draft.severity === 'critical' && draft.rules.length === 1) {
      findings.push({
        severity: 'info',
        message: 'Critical severity carried by a single rule. Consider whether the constraint is fully expressed.'
      });
    }

    return findings;
  }
}
