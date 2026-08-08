import { useState } from 'react';
import { api, Paginated, ReservationRow, ordersApi } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

const STATUSES = ['', 'held', 'confirmed', 'released', 'expired', 'failed', 'reconcile'];

function remainingHint(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.round(ms / 60000);
  return mins < 1 ? '<1 min left' : `${mins} min left`;
}

export function Reservations() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<ReservationRow>>(
      `/reservations?page=${page}&pageSize=${pageSize}${status ? `&status=${status}` : ''}`),
    [page, status],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function release(orderId: string) {
    setBusy(orderId);
    setActionError(null);
    try {
      await ordersApi.releaseReservations(orderId);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reservations</h1>
          <p>Stock holds created during checkout — held, confirmed, released, or expired.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span>
            <label className="field" style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              Status
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s || 'all'}</option>)}
              </select>
            </label>
          </span>
          <span>
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>{' '}
            <span className="hint">{page} / {maxPage}</span>{' '}
            <button className="btn ghost sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        </div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {actionError && <div className="err" style={{ padding: '0 16px' }}>{actionError}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.items.length ? (
          <div className="empty">No reservations yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th><th>Qty</th><th>Mode</th><th>Status</th><th>External ref</th>
                <th>Expires</th><th>Promised</th><th>Fail reason</th><th>Order</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => {
                const remaining = remainingHint(r.expiresAt);
                return (
                  <tr key={r.id}>
                    <td className="mono">{r.sku}</td>
                    <td>{r.qty}</td>
                    <td className="mono">{r.mode}</td>
                    <td><span className={statusBadgeClass(r.status)}>{r.status}</span></td>
                    <td className="mono">{r.externalRef ?? '—'}</td>
                    <td>
                      {r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '—'}
                      {remaining && <div className="hint">{remaining}</div>}
                    </td>
                    <td>{r.promisedDate ?? '—'}</td>
                    <td>{r.failReason ?? '—'}</td>
                    <td className="mono">{r.orderId.slice(0, 8)}…</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" disabled={r.status !== 'held' || busy === r.orderId}
                        title="Releases ALL held reservations on this order" onClick={() => release(r.orderId)}>
                        {busy === r.orderId ? '…' : 'Release order holds'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
