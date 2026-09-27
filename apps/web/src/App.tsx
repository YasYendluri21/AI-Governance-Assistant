import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Console } from './views/Console.js';
import { Dashboard } from './views/Dashboard.js';
import { Policies } from './views/Policies.js';

type Tab = 'console' | 'policies' | 'dashboard';

const TABS: Array<[Tab, string]> = [
  ['console', 'Console'],
  ['policies', 'Policies'],
  ['dashboard', 'Dashboard']
];

export function App() {
  const [tab, setTab] = useState<Tab>('console');
  const [health, setHealth] = useState<{ llmProvider: string; auditArchive: string } | null>(null);

  // The reviewer identity would come from SSO in a deployment. Here it is editable so the approval
  // path can be demonstrated as two different people without an auth flow.
  const [reviewer, setReviewer] = useState('priya@example.com');

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>AI Governance Assistant</strong>
            <span className="hint"> policy workflows with a human in the loop</span>
          </div>
        </div>

        <nav className="tabs">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? 'tab tab-active' : 'tab'}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        <label className="identity">
          <span className="hint">Acting as</span>
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            aria-label="Reviewer identity"
          />
        </label>
      </header>

      <main>
        {tab === 'console' && <Console reviewer={reviewer} />}
        {tab === 'policies' && <Policies />}
        {tab === 'dashboard' && <Dashboard />}
      </main>

      <footer className="footer hint">
        {health ? (
          <>
            Model provider: {health.llmProvider} · Audit archive: {health.auditArchive}
          </>
        ) : (
          'API unreachable — start it with npm run dev:api'
        )}
      </footer>
    </div>
  );
}
