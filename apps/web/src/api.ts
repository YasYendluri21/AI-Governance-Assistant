import type { AuditEntry, Policy, Run, RunEvent } from '@aga/shared';

/** A run as the detail endpoint returns it: the run plus everything needed to render it. */
export interface RunDetail extends Run {
  events: RunEvent[];
  policy: Policy | null;
}

export interface Dashboard {
  totals: { runs: number; activePolicies: number; awaitingApproval: number };
  byStatus: Record<string, number>;
  failuresByStep: Record<string, number>;
  latency: { p50: number | null; p95: number | null };
  recentEvents: RunEvent[];
  audit: AuditEntry[];
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });

  if (!res.ok) {
    // The API puts a human-readable reason in `error`. Surfacing it beats a bare status code.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  health: () => json<{ llmProvider: string; auditArchive: string }>('/api/health'),
  dashboard: () => json<Dashboard>('/api/dashboard'),
  policies: (status?: string) =>
    json<Policy[]>(`/api/policies${status ? `?status=${status}` : ''}`),
  runs: () => json<Run[]>('/api/runs'),
  run: (id: string) => json<RunDetail>(`/api/runs/${id}`),

  startRun: (request: string, owner: string) =>
    json<Run>('/api/runs', { method: 'POST', body: JSON.stringify({ request, owner }) }),

  decide: (id: string, approved: boolean, reviewer: string, note: string) =>
    json<Run>(`/api/runs/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ approved, reviewer, note })
    })
};

/**
 * Subscribe to a run's progress. Returns an unsubscribe function.
 *
 * EventSource reconnects on its own, and every frame carries a full snapshot rather than a delta,
 * so a dropped connection resolves itself without the client tracking what it missed.
 */
export function watchRun(
  id: string,
  onUpdate: (payload: { run: Run; events: RunEvent[] }) => void
): () => void {
  const source = new EventSource(`/api/runs/${id}/stream`);

  source.onmessage = (message) => {
    try {
      onUpdate(JSON.parse(message.data));
    } catch {
      // A malformed frame is not worth tearing the stream down for; the next snapshot corrects it.
    }
  };

  return () => source.close();
}
