import cors from 'cors';
import express from 'express';
import { audit, events, policies, runs } from './db.js';
import { decide, startRun, subscribe } from './agent/orchestrator.js';
import { archiveEnabled } from './aws/audit-archive.js';
import { createProvider } from './llm/index.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const provider = createProvider();

/** Wrap an async handler so a rejected promise becomes a 500 instead of an unhandled rejection. */
const handle =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(500).json({ error: message });
    });
  };

/* ---------- health ---------- */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    llmProvider: provider.name,
    auditArchive: archiveEnabled ? 'enabled' : 'disabled'
  });
});

/* ---------- policies ---------- */

app.get('/api/policies', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(policies.list(status));
});

app.get('/api/policies/:id', (req, res) => {
  const policy = policies.get(req.params.id ?? '');
  if (!policy) {
    res.status(404).json({ error: 'No such policy' });
    return;
  }
  res.json(policy);
});

/* ---------- runs ---------- */

app.get('/api/runs', (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(runs.list(Number.isFinite(limit) ? limit : 50));
});

app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id ?? '');
  if (!run) {
    res.status(404).json({ error: 'No such run' });
    return;
  }
  res.json({
    ...run,
    events: events.forRun(run.id),
    policy: run.policyId ? policies.get(run.policyId) : null
  });
});

app.post(
  '/api/runs',
  handle(async (req, res) => {
    const request = String(req.body?.request ?? '').trim();
    const owner = String(req.body?.owner ?? 'unattributed');

    if (request.length < 10) {
      res.status(400).json({ error: 'Describe the policy in a sentence or more' });
      return;
    }

    const run = await startRun(request, owner);
    res.status(201).json(run);
  })
);

app.post(
  '/api/runs/:id/decision',
  handle(async (req, res) => {
    const id = req.params.id ?? '';
    const approved = Boolean(req.body?.approved);
    const reviewer = String(req.body?.reviewer ?? '').trim();
    const note = String(req.body?.note ?? '');

    if (!reviewer) {
      res.status(400).json({ error: 'A decision needs a named reviewer' });
      return;
    }

    try {
      res.json(await decide(id, approved, reviewer, note));
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
    }
  })
);

/** Live run progress over SSE, so the console shows steps as they land rather than on refresh. */
app.get('/api/runs/:id/stream', (req, res) => {
  const run = runs.get(req.params.id ?? '');
  if (!run) {
    res.status(404).json({ error: 'No such run' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ type: 'snapshot', run, events: events.forRun(run.id) });

  const unsubscribe = subscribe(run.id, ({ type, run: updated }) => {
    send({ type, run: updated, events: events.forRun(updated.id) });
  });

  // Comment frames keep proxies from closing an idle stream while a run waits on a human.
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

/* ---------- observability ---------- */

app.get('/api/dashboard', (_req, res) => {
  const all = runs.list(200);
  const completed = all.filter((r) => r.durationMs !== null);

  const byStatus = all.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  // Where runs fail, by step. The most useful single number when a workflow starts degrading.
  const failuresByStep = all
    .flatMap((r) => r.steps.filter((s) => s.status === 'failed'))
    .reduce<Record<string, number>>((acc, s) => {
      acc[s.name] = (acc[s.name] ?? 0) + 1;
      return acc;
    }, {});

  const durations = completed.map((r) => r.durationMs!).sort((a, b) => a - b);
  const p50 = durations.length ? durations[Math.floor(durations.length * 0.5)]! : null;
  const p95 = durations.length ? durations[Math.floor(durations.length * 0.95)]! : null;

  res.json({
    totals: {
      runs: all.length,
      activePolicies: policies.list('active').length,
      awaitingApproval: all.filter((r) => r.status === 'awaiting_approval').length
    },
    byStatus,
    failuresByStep,
    latency: { p50, p95 },
    recentEvents: events.recent(20),
    audit: audit.list(25)
  });
});

app.get('/api/audit', (_req, res) => {
  res.json(audit.list(200));
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
  console.log(`llm provider: ${provider.name}`);
  console.log(`audit archive: ${archiveEnabled ? 'S3 enabled' : 'disabled (local only)'}`);
});
