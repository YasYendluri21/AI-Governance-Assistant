import { useEffect, useState } from 'react';
import { api, type Dashboard as DashboardData } from '../api.js';

function ms(value: number | null): string {
  if (value === null) return '—';
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

/**
 * Operational view of the workflow: what ran, what is blocked on a person, where runs fail, and
 * the audit trail behind every activation.
 *
 * The failures-by-step breakdown is the number worth watching. Total failure count says something
 * is wrong; failures concentrated in one step says what.
 */
export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const load = () =>
      api
        .dashboard()
        .then((next) => live && setData(next))
        .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));

    void load();
    const timer = setInterval(load, 5000);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="hint">Loading…</p>;

  const statuses = Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]);
  const failures = Object.entries(data.failuresByStep).sort((a, b) => b[1] - a[1]);

  return (
    <div className="dashboard">
      <section className="tiles">
        <div className="tile">
          <span className="tile-label">Runs</span>
          <strong className="tile-value">{data.totals.runs}</strong>
        </div>
        <div className="tile">
          <span className="tile-label">Active policies</span>
          <strong className="tile-value">{data.totals.activePolicies}</strong>
        </div>
        <div className={`tile ${data.totals.awaitingApproval ? 'tile-attention' : ''}`}>
          <span className="tile-label">Awaiting approval</span>
          <strong className="tile-value">{data.totals.awaitingApproval}</strong>
        </div>
        <div className="tile">
          <span className="tile-label">Run time p50 / p95</span>
          <strong className="tile-value tile-value-sm">
            {ms(data.latency.p50)} / {ms(data.latency.p95)}
          </strong>
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <h2>Runs by status</h2>
          {statuses.length === 0 && <p className="hint">No runs yet.</p>}
          <ul className="bars">
            {statuses.map(([status, count]) => (
              <li key={status}>
                <span className={`status status-${status}`}>{status.replace(/_/g, ' ')}</span>
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{ width: `${(count / data.totals.runs) * 100}%` }}
                  />
                </div>
                <span className="count">{count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Failures by step</h2>
          {failures.length === 0 ? (
            <p className="hint">No failed steps recorded.</p>
          ) : (
            <ul className="bars">
              {failures.map(([step, count]) => (
                <li key={step}>
                  <span className="step-name">{step}</span>
                  <div className="bar">
                    <div
                      className="bar-fill bar-fill-error"
                      style={{ width: `${(count / failures[0]![1]) * 100}%` }}
                    />
                  </div>
                  <span className="count">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Audit history</h2>
        {data.audit.length === 0 ? (
          <p className="hint">Nothing activated yet.</p>
        ) : (
          <div className="scroller">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Policy</th>
                  <th>Ver</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Archived</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="nowrap">{new Date(entry.at).toLocaleString()}</td>
                    <td>{entry.policyName}</td>
                    <td className="num">{entry.policyVersion}</td>
                    <td>
                      <span className={`chip chip-${entry.action}`}>{entry.action}</span>
                    </td>
                    <td>{entry.actor}</td>
                    <td className="hint">{entry.archivedTo ?? 'local only'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Recent activity</h2>
        <ul className="event-list">
          {data.recentEvents.map((event) => (
            <li key={event.id} className={`event event-${event.level}`}>
              <span className="event-time">{new Date(event.at).toLocaleTimeString()}</span>
              <span className="event-step">{event.step ?? 'run'}</span>
              <span>{event.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
