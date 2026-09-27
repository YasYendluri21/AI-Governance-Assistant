import { useState } from 'react';
import type { Run, RunEvent, RunStep } from '@aga/shared';

const STEP_LABELS: Record<RunStep['name'], string> = {
  retrieve: 'Retrieve',
  validate: 'Validate',
  approve: 'Approve',
  execute: 'Execute'
};

const STEP_DETAIL: Record<RunStep['name'], string> = {
  retrieve: 'Find policies already in force that bear on this request',
  validate: 'Draft the structured policy and check it for conflicts',
  approve: 'Hold for a human decision before anything changes',
  execute: 'Activate the policy and write the audit record'
};

function duration(ms: number | null): string {
  if (ms === null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * A run rendered as its four steps, plus the approval control when the run is waiting on one.
 *
 * Step state is shown as state, not as a spinner: a reader should be able to tell at a glance which
 * step a run stopped at and why, without opening the event log.
 */
export function RunTimeline({
  run,
  events,
  onDecide
}: {
  run: Run;
  events: RunEvent[];
  onDecide: (approved: boolean, note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [showEvents, setShowEvents] = useState(true);

  return (
    <section className="panel">
      <div className="run-head">
        <div>
          <h2>Run {run.id}</h2>
          <p className="hint">{run.request}</p>
        </div>
        <span className={`status status-${run.status}`}>{run.status.replace(/_/g, ' ')}</span>
      </div>

      <ol className="steps">
        {run.steps.map((step) => (
          <li key={step.name} className={`step step-${step.status}`}>
            <div className="step-mark" aria-hidden="true" />
            <div className="step-body">
              <div className="step-title">
                <strong>{STEP_LABELS[step.name]}</strong>
                <span className="hint">{duration(step.durationMs)}</span>
              </div>
              <p className="hint">{STEP_DETAIL[step.name]}</p>

              {step.error && <p className="error">{step.error}</p>}

              {step.output != null && step.status === 'succeeded' && (
                <details>
                  <summary className="hint">Output</summary>
                  <pre>{JSON.stringify(step.output, null, 2)}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>

      {run.status === 'awaiting_approval' && (
        <div className="checkpoint">
          <h3>Human checkpoint</h3>
          <p className="hint">
            The policy is drafted and validated but not in force. Nothing changes until someone
            decides.
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the audit record (optional on approval, expected on rejection)"
            aria-label="Decision note"
          />
          <div className="row">
            <button type="button" onClick={() => onDecide(true, note)}>
              Approve and activate
            </button>
            <button type="button" className="secondary" onClick={() => onDecide(false, note)}>
              Reject
            </button>
          </div>
        </div>
      )}

      {run.decision && (
        <p className="decision">
          {run.decision.approved ? 'Approved' : 'Rejected'} by <strong>{run.decision.by}</strong>
          {run.decision.note && <> — {run.decision.note}</>}
        </p>
      )}

      <div className="events">
        <button type="button" className="link" onClick={() => setShowEvents((v) => !v)}>
          {showEvents ? 'Hide' : 'Show'} event log ({events.length})
        </button>

        {showEvents && (
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id} className={`event event-${event.level}`}>
                <span className="event-time">{new Date(event.at).toLocaleTimeString()}</span>
                <span className="event-step">{event.step ?? 'run'}</span>
                <span>{event.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
