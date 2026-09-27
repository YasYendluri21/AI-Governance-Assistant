import { nanoid } from 'nanoid';
import type { Policy } from '@aga/shared';
import { policies } from './db.js';

/**
 * Seeds two active policies so a fresh clone has something for retrieval and conflict detection to
 * work against. Without them the first run always reports an empty policy set, which makes the
 * validation step look like it does nothing.
 *
 * The second policy is deliberately chosen to conflict with a common request ("let the team use
 * external models for prototyping"), so the blocker path is reachable in a demo.
 */

const now = new Date().toISOString();

const seeds: Policy[] = [
  {
    id: nanoid(8),
    version: 1,
    status: 'active',
    name: 'Restricted data may not reach external models',
    description:
      'Prompts carrying customer PII or payment data must not be sent to models hosted outside the organisation boundary.',
    severity: 'critical',
    owner: 'security@example.com',
    scope: { models: ['*'], dataClasses: ['pii', 'pci'], environments: ['production', 'staging'] },
    rules: [
      {
        subject: 'model.provider',
        effect: 'deny',
        condition: 'the model is hosted outside the organisation boundary',
        rationale: 'Restricted data leaving the boundary is a reportable incident.'
      },
      {
        subject: 'telemetry.audit_log',
        effect: 'require',
        condition: 'the interaction is written to the immutable audit log',
        rationale: 'Regulators ask for evidence, not assurances.'
      }
    ],
    references: ['EU AI Act Art. 10', 'SOC 2 CC6.1'],
    createdAt: now,
    updatedAt: now
  },
  {
    id: nanoid(8),
    version: 1,
    status: 'active',
    name: 'Generated code requires human review before merge',
    description:
      'Model-generated code may be committed to a branch but requires a named human reviewer before it reaches a protected branch.',
    severity: 'high',
    owner: 'engineering@example.com',
    scope: { models: ['*'], dataClasses: ['source-code'], environments: ['production'] },
    rules: [
      {
        subject: 'workflow.human_review',
        effect: 'require',
        condition: 'a named reviewer approves before the action proceeds',
        rationale: 'Review is the control that makes generated code auditable.'
      }
    ],
    references: [],
    createdAt: now,
    updatedAt: now
  }
];

for (const policy of seeds) {
  policies.upsert(policy);
  console.log(`seeded: ${policy.name}`);
}

console.log(`\n${seeds.length} policies active. Start the API and open the console.`);
