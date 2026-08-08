import { useState } from 'react';
import { api, Integration, SyncJob } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

const OPERATIONS = ['customers', 'products', 'inventory', 'prices'] as const;

export function SyncJobs() {
  const jobs = useAsync(() => api.get<SyncJob[]>('/sync-jobs'));
  const integrations = useAsync(() => api.get<Integration[]>('/integrations'));
  const [integrationId, setIntegrationId] = useState('');
  const [operation, setOperation] = useState<(typeof OPERATIONS)[number]>('customers');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function trigger(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/sync-jobs', { integrationId, operation });
      setTimeout(() => jobs.reload(), 600);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Sync jobs</h1>
          <p>Run a connector sync operation and track its result.</p>
        </div>
        <button className="btn ghost" onClick={jobs.reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">Trigger a sync</div>
        <form className="stack" onSubmit={trigger}>
          <div className="row">
            <label className="field">
              Integration
              <select required value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
                <option value="" disabled>Select…</option>
                {integrations.data?.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
                ))}
              </select>
            </label>
            <label className="field">
              Operation
              <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
                {OPERATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={busy || !integrationId}>{busy ? 'Triggering…' : 'Run sync'}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">Job history</div>
        {jobs.loading ? <div className="empty">Loading…</div> : !jobs.data?.length ? (
          <div className="empty">No sync jobs yet.</div>
        ) : (
          <table>
            <thead><tr><th>Started</th><th>Operation</th><th>Status</th><th>Result</th></tr></thead>
            <tbody>
              {jobs.data.map((j) => (
                <tr key={j.id}>
                  <td>{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="mono">{j.operation}</td>
                  <td><span className={statusBadgeClass(j.status)}>{j.status}</span></td>
                  <td className="mono">{j.result ? JSON.stringify(j.result) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
