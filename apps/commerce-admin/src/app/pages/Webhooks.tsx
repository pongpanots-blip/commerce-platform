import { useState } from 'react';
import { api, WebhookEvent } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

export function Webhooks() {
  const { data, loading, error, reload } = useAsync(() => api.get<WebhookEvent[]>('/webhooks'));
  const [selected, setSelected] = useState<WebhookEvent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function replay(id: string) {
    setBusy(id);
    try {
      await api.post(`/webhooks/replay/${id}`, {});
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Webhook events</h1>
          <p>Inbound webhooks — stored raw, processed asynchronously, replayable.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">Recent events</div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.length ? (
          <div className="empty">No webhook events yet.</div>
        ) : (
          <table>
            <thead><tr><th>Received</th><th>Integration</th><th>Signature</th><th>Status</th><th>Attempts</th><th></th></tr></thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id}>
                  <td>{new Date(w.createdAt).toLocaleString()}</td>
                  <td className="mono">{w.integrationId.slice(0, 8)}…</td>
                  <td>{w.signatureValid
                    ? <span className="badge ok">valid</span>
                    : <span className="badge danger">invalid</span>}</td>
                  <td><span className={statusBadgeClass(w.status)}>{w.status}</span></td>
                  <td>{w.attempts}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => setSelected(w)}>View</button>{' '}
                    <button className="btn sm" disabled={busy === w.id || !w.signatureValid}
                      onClick={() => replay(w.id)}>
                      {busy === w.id ? '…' : 'Replay'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="panel">
          <div className="panel-head">
            Payload · {selected.id.slice(0, 8)}…
            <button className="btn ghost sm" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div style={{ padding: 16 }}>
            <pre className="payload">{JSON.stringify(selected.payload, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
