import { useEffect, useRef, useState } from 'react';
import type { Run, RunEvent } from '@aga/shared';
import { api, watchRun } from '../api.js';
import { RunTimeline } from './RunTimeline.js';

const EXAMPLES = [
  'Prompts containing customer PII must never be sent to external models, and every attempt should be logged.',
  'Generated code touching payment flows requires review by a named engineer before merge.',
  'Let the team use external models for prototyping in development without approval.'
];

/**
 * The conversational surface: a natural-language request in, a structured policy out, with the
 * agent's progress streaming underneath it.
 *
 * The request box stays available while a run is in flight — a governance team thinks in batches,
 * and blocking the input until a run finishes would be the wrong model of how the work happens.
 */
export function Console({ reviewer }: { reviewer: string }) {
  const [request, setRequest] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const unwatch = useRef<(() => void) | null>(null);

  useEffect(() => () => unwatch.current?.(), []);

  async function submit(text: string) {
    setError(null);
    setStarting(true);
    unwatch.current?.();

    try {
      const started = await api.startRun(text, reviewer);
      setRun(started);
      setEvents([]);
      setRequest('');

      // Subscribe after the run exists so the first snapshot already carries its steps.
      unwatch.current = watchRun(started.id, ({ run: updated, events: updatedEvents }) => {
        setRun(updated);
        setEvents(updatedEvents);
      });

      const detail = await api.run(started.id);
      setEvents(detail.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function decide(approved: boolean, note: string) {
    if (!run) return;
    setError(null);
    try {
      setRun(await api.decide(run.id, approved, reviewer, note));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="console">
      <section className="panel">
        <h2>Describe a policy</h2>
        <p className="hint">
          Plain language. The assistant turns it into a structured policy, checks it against what is
          already in force, and holds it for your approval before anything takes effect.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (request.trim().length >= 10) void submit(request);
          }}
        >
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="No prompt containing personal data may be sent to a model outside our infrastructure."
            rows={4}
            aria-label="Policy request"
          />
          <div className="row">
            <button type="submit" disabled={starting || request.trim().length < 10}>
              {starting ? 'Starting run…' : 'Draft policy'}
            </button>
            <span className="hint">as {reviewer}</span>
          </div>
        </form>

        <div className="examples">
          <span className="hint">Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="link"
              onClick={() => setRequest(example)}
            >
              {example.length > 58 ? `${example.slice(0, 58)}…` : example}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
      </section>

      {run && <RunTimeline run={run} events={events} onDecide={decide} />}
    </div>
  );
}
