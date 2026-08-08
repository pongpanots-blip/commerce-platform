import { useState } from 'react';
import { api, ErpStubStockRow, Paginated } from '../../lib/api';
import { useAsync } from '../hooks';

export function ErpStock() {
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<ErpStubStockRow>>('/erp-stub/stock'), []);
  const [form, setForm] = useState({ sku: '', qty: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function upsert(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await api.put('/erp-stub/stock', { sku: form.sku, qty: Number(form.qty) });
      setForm({ sku: '', qty: '' });
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ERP stub stock</h1>
          <p>Simulated ERP inventory — set stock levels for the on_hand fulfillment mode.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-head">Set stock level</div>
        <form className="stack" onSubmit={upsert}>
          <div className="row">
            <label className="field">
              SKU
              <input required value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="e.g. SKU-A" />
            </label>
            <label className="field">
              Quantity
              <input required value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
                placeholder="0" />
            </label>
          </div>
          {formError && <div className="err">{formError}</div>}
          <div><button className="btn" disabled={submitting}>{submitting ? 'Saving…' : 'Set stock'}</button></div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-head">Stock levels</div>
        {error && <div className="err" style={{ padding: 16 }}>{error}</div>}
        {loading ? <div className="empty">Loading…</div> : !data?.items.length ? (
          <div className="empty">No stock rows yet.</div>
        ) : (
          <table>
            <thead><tr><th>SKU</th><th>Qty</th></tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.sku}</td>
                  <td>{s.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
