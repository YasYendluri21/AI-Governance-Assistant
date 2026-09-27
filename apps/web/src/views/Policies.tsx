import { useEffect, useState } from 'react';
import type { Policy } from '@aga/shared';
import { api } from '../api.js';

/** The policy register: what is in force, what was rejected, and what each rule actually says. */
export function Policies() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('active');

  useEffect(() => {
    let live = true;
    api
      .policies(filter === 'all' ? undefined : filter)
      .then((next) => live && setPolicies(next))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [filter]);

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="policies">
      <div className="row filters">
        {['active', 'awaiting_approval', 'rejected', 'archived', 'all'].map((option) => (
          <button
            key={option}
            type="button"
            className={filter === option ? 'chip chip-selected' : 'chip'}
            onClick={() => setFilter(option)}
          >
            {option.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {policies.length === 0 && <p className="hint">No policies with this status.</p>}

      {policies.map((policy) => (
        <section className="panel" key={policy.id}>
          <div className="run-head">
            <div>
              <h2>{policy.name}</h2>
              <p className="hint">{policy.description}</p>
            </div>
            <div className="policy-meta">
              <span className={`status status-${policy.status}`}>
                {policy.status.replace(/_/g, ' ')}
              </span>
              <span className={`chip chip-${policy.severity}`}>{policy.severity}</span>
              <span className="hint">v{policy.version}</span>
            </div>
          </div>

          <dl className="scope">
            <div>
              <dt>Models</dt>
              <dd>{policy.scope.models.join(', ')}</dd>
            </div>
            <div>
              <dt>Data classes</dt>
              <dd>{policy.scope.dataClasses.join(', ') || 'any'}</dd>
            </div>
            <div>
              <dt>Environments</dt>
              <dd>{policy.scope.environments.join(', ')}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{policy.owner}</dd>
            </div>
          </dl>

          <ul className="rules">
            {policy.rules.map((rule, i) => (
              <li key={`${rule.subject}-${i}`}>
                <code>{rule.subject}</code>
                <span className={`chip chip-${rule.effect}`}>{rule.effect}</span>
                <span>{rule.condition}</span>
                {rule.rationale && <p className="hint">{rule.rationale}</p>}
              </li>
            ))}
          </ul>

          {policy.references.length > 0 && (
            <p className="hint">References: {policy.references.join(' · ')}</p>
          )}
        </section>
      ))}
    </div>
  );
}
