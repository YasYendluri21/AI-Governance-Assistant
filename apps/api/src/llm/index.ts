import { ClaudeProvider } from './claude.js';
import { MockProvider } from './mock.js';
import type { LlmProvider } from './types.js';

export type { LlmProvider, ReviewFinding } from './types.js';

/**
 * Provider selection. "auto" — the default — uses Claude when a key is present and the mock
 * otherwise, so a fresh clone runs immediately and a configured one exercises the real path.
 */
export function createProvider(): LlmProvider {
  const mode = process.env.LLM_PROVIDER ?? 'auto';

  if (mode === 'mock') return new MockProvider();
  if (mode === 'claude') return new ClaudeProvider();

  return process.env.ANTHROPIC_API_KEY ? new ClaudeProvider() : new MockProvider();
}
