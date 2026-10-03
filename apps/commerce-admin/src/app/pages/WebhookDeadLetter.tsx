import { Fragment, useState } from 'react';
import { webhookApi, WebhookDeliveryFull } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

export function WebhookDeadLetter() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');

  const { data: deliveries, loading, error, reload } = useAsync(() => webhookApi.deliveries(), []);

  async function retryDelivery(id: string) {
    setBusy(`retry-${id}`);
    setActionError('');
    try {
      await webhookApi.retryDelivery(id);
      setMessage('Retry queued');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const failedDeliveries = deliveries?.filter((d: WebhookDeliveryFull) => d.status === 'failed') || [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Webhook Dead Letter</h1>
          <p>View and retry failed webhook deliveries.</p>
        </div>
        <button className="btn ghost" onClick={reload}>
          Refresh
        </button>
      </div>

      {message && <div style={{ padding: 16, background: '#e6f4ea', color: '#157347', borderRadius: 6, marginBottom: 16 }}>{message}</div>}
      {error && <div style={{ padding: 16, background: '#fbe4e6', color: '#c2333f', borderRadius: 6, marginBottom: 16 }}>{error}</div>}
      {actionError && <div style={{ padding: 16, background: '#fbe4e6', color: '#c2333f', borderRadius: 6, marginBottom: 16 }}>{actionError}</div>}

      <div className="panel">
        <div className="panel-head">Failed Deliveries ({failedDeliveries.length})</div>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : !failedDeliveries.length ? (
          <div className="empty">No failed webhook deliveries.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Target URL</th>
                <th>Status Code</th>
                <th>Attempts</th>
                <th>Error</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {failedDeliveries.map((delivery: WebhookDeliveryFull) => (
                <Fragment key={delivery.id}>
                  <tr>
                    <td>{delivery.eventType}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {delivery.targetUrl}
                    </td>
                    <td>{delivery.statusCode || '—'}</td>
                    <td>{delivery.attempts}</td>
                    <td style={{ fontSize: 12, color: '#c2333f' }}>
                      {delivery.error ? delivery.error.substring(0, 40) + '…' : '—'}
                    </td>
                    <td className="mono">{new Date(delivery.createdAt).toLocaleString()}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => setExpandedId((cur) => (cur === delivery.id ? null : delivery.id))}>
                        {expandedId === delivery.id ? 'Hide' : 'View'}
                      </button>{' '}
                      <button
                        className="btn sm"
                        disabled={busy === `retry-${delivery.id}`}
                        onClick={() => retryDelivery(delivery.id)}
                      >
                        {busy === `retry-${delivery.id}` ? '…' : 'Retry'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === delivery.id && (
                    <tr>
                      <td colSpan={7} style={{ padding: 16 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div>
                            <div className="hint">Full Error</div>
                            <pre className="payload">{delivery.error || '(none)'}</pre>
                          </div>
                          {delivery.payload !== undefined && (
                            <div>
                              <div className="hint">Payload</div>
                              <pre className="payload">{JSON.stringify(delivery.payload, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deliveries && deliveries.length > failedDeliveries.length && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">Summary</div>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {['pending', 'success', 'failed'].map((status) => {
                const count = deliveries.filter((d: WebhookDeliveryFull) => d.status === status).length;
                return count > 0 ? (
                  <tr key={status}>
                    <td>
                      <span className={statusBadgeClass(status)}>{status}</span>
                    </td>
                    <td>{count}</td>
                  </tr>
                ) : null;
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
