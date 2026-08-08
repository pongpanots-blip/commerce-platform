import { useState } from 'react';
import { api, ordersApi, OrderFull, OrderRow, Paginated } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

const MAX_LINES = 3;

interface LineForm {
  productId: string;
  qty: string;
  unitPrice: string;
}

const emptyLine: LineForm = { productId: '', qty: '', unitPrice: '' };

export function Orders() {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<OrderRow>>(`/orders?page=${page}&pageSize=${pageSize}`),
    [page],
  );

  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineForm[]>([{ ...emptyLine }, { ...emptyLine }, { ...emptyLine }]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detail = useAsync<OrderFull | null>(
    () => (expandedId ? ordersApi.full(expandedId) : Promise.resolve(null)),
    [expandedId],
  );

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        customerId,
        lines: lines
          .filter((l) => l.productId)
          .map((l) => ({
            productId: l.productId,
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice),
          })),
      };
      if (!payload.lines.length) {
        setFormError('Add at least one line.');
        setSubmitting(false);
        return;
      }
      await api.post('/orders', payload);
      setCustomerId('');
      setLines([{ ...emptyLine }, { ...emptyLine }, { ...emptyLine }]);
      if (page !== 1) setPage(1);
      else reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleExpand(id: string) {
    setActionError(null);
    setExpandedId((cur) => (cur === id ? null : id));
  }

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setActionBusy(key);
    setActionError(null);
    try {
      await fn();
      detail.reload();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(null);
    }
  }

  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p>Create orders, walk checkout / payment, and inspect reservations.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">New order</div>
        <form className="stack" onSubmit={submit}>
          <div className="row">
            <label className="field">
              Customer ID
              <input required value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="uuid" />
            </label>
          </div>
          {lines.map((l, i) => (
            <div className="row" key={i}>
              <label className="field">
                Product ID (line {i + 1})
                <input value={l.productId}
                  onChange={(e) => updateLine(i, { productId: e.target.value })}
                  placeholder="uuid" />
              </label>
              <label className="field">
                Qty
                <input value={l.qty}
                  onChange={(e) => updateLine(i, { qty: e.target.value })}
                  placeholder="1" />
              </label>
              <label className="field">
                Unit price
                <input value={l.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                  placeholder="0.00" />
              </label>
            </div>
          ))}
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={submitting}>{submitting ? 'Creating…' : 'Create order'}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span>{total} total</span>
          <span>
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>{' '}
            <span className="hint">{page} / {maxPage}</span>{' '}
            <button className="btn ghost sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        </div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.items.length ? (
          <div className="empty">No orders yet.</div>
        ) : (
          <table>
            <thead><tr><th>Code</th><th>Status</th><th>Total</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.code ?? o.id.slice(0, 8) + '…'}</td>
                  <td><span className={statusBadgeClass(o.status)}>{o.status}</span></td>
                  <td>{o.currency} {o.total}</td>
                  <td>{new Date(o.createdAt).toLocaleString()}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => toggleExpand(o.id)}>
                      {expandedId === o.id ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {expandedId && (
        <div className="panel">
          <div className="panel-head">
            Order detail · {expandedId.slice(0, 8)}…
            <button className="btn ghost sm" onClick={() => setExpandedId(null)}>Close</button>
          </div>
          {detail.loading ? <div className="empty">Loading…</div> : detail.error ? (
            <div className="err" style={{ padding: 16 }}>{detail.error}</div>
          ) : !detail.data ? (
            <div className="empty">No detail.</div>
          ) : (
            <div style={{ padding: 16 }} className="stack">
              {actionError && <div className="err">{actionError}</div>}

              <div className="row">
                {detail.data.order.status === 'draft' && (
                  <button className="btn sm" disabled={actionBusy === 'checkout'}
                    onClick={() => runAction('checkout', () => ordersApi.checkout(detail.data!.order.id))}>
                    {actionBusy === 'checkout' ? '…' : 'Checkout'}
                  </button>
                )}
                {detail.data.order.status === 'pending_payment' && detail.data.payment?.status === 'pending' && (
                  <>
                    <button className="btn sm" disabled={actionBusy === 'pay'}
                      onClick={() => runAction('pay', () => ordersApi.pay(detail.data!.payment!.id))}>
                      {actionBusy === 'pay' ? '…' : 'Mark paid'}
                    </button>
                    <button className="btn ghost sm" disabled={actionBusy === 'fail'}
                      onClick={() => runAction('fail', () => ordersApi.failPay(detail.data!.payment!.id))}>
                      {actionBusy === 'fail' ? '…' : 'Mark failed'}
                    </button>
                  </>
                )}
                {detail.data.reservations.some((r) => r.status === 'held') && (
                  <button className="btn ghost sm" disabled={actionBusy === 'release'}
                    onClick={() => runAction('release', () => ordersApi.releaseReservations(detail.data!.order.id))}>
                    {actionBusy === 'release' ? '…' : 'Release holds'}
                  </button>
                )}
              </div>

              <div>
                <div className="hint" style={{ marginBottom: 6 }}>Lines</div>
                {!detail.data.lines.length ? <div className="empty">No lines.</div> : (
                  <table>
                    <thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
                    <tbody>
                      {detail.data.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="mono">{l.productId.slice(0, 8)}…</td>
                          <td>{l.qty}</td>
                          <td>{l.unitPrice}</td>
                          <td>{l.lineTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <div className="hint" style={{ marginBottom: 6 }}>Fulfillments</div>
                {!detail.data.fulfillments.length ? <div className="empty">No fulfillments.</div> : (
                  <table>
                    <thead><tr><th>Source</th><th>Mode</th><th>Status</th></tr></thead>
                    <tbody>
                      {detail.data.fulfillments.map((f) => (
                        <tr key={f.id}>
                          <td className="mono">{f.source}</td>
                          <td className="mono">{f.mode}</td>
                          <td><span className={statusBadgeClass(f.status)}>{f.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <div className="hint" style={{ marginBottom: 6 }}>Reservations</div>
                {!detail.data.reservations.length ? <div className="empty">No reservations.</div> : (
                  <table>
                    <thead><tr><th>SKU</th><th>Qty</th><th>Status</th><th>External ref</th><th>Expires</th><th>Promised</th><th>Fail reason</th></tr></thead>
                    <tbody>
                      {detail.data.reservations.map((r) => (
                        <tr key={r.id}>
                          <td className="mono">{r.sku}</td>
                          <td>{r.qty}</td>
                          <td><span className={statusBadgeClass(r.status)}>{r.status}</span></td>
                          <td className="mono">{r.externalRef ?? '—'}</td>
                          <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '—'}</td>
                          <td>{r.promisedDate ?? '—'}</td>
                          <td>{r.failReason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {detail.data.payment && (
                <div>
                  <div className="hint" style={{ marginBottom: 6 }}>Payment</div>
                  <table>
                    <thead><tr><th>Status</th><th>Method</th><th>Amount</th></tr></thead>
                    <tbody>
                      <tr>
                        <td><span className={statusBadgeClass(detail.data.payment.status)}>{detail.data.payment.status}</span></td>
                        <td>{detail.data.payment.method ?? '—'}</td>
                        <td>{detail.data.payment.currency} {detail.data.payment.amount}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
