import { FormEvent, Fragment, useState } from 'react';
import { joshErpLogApi } from '../../lib/api';
import { useAsync } from '../hooks';

// Same list as josh's ERP_LOG_ENDPOINTS (shared-api erp-log.api.ts).
const ENDPOINTS = ['products/qty', 'products/price', 'products/moq', 'products', 'products/bulk', 'products/image', 'customers', 'companies',
  'orders/status', 'invoices/status', 'quotations', 'quotations/status', 'order-periods'];
const LIMIT = 50;
/** <input type="datetime-local"> value (local time) → ISO, or undefined. */
const iso = (v: string) => (v ? new Date(v).toISOString() : undefined);

/** josh's ERP inbound log (moved from josh web-admin "ERP logs"): read from josh's log DB, kept 14 days there. */
export function JoshErpLogs() {
  const [draft, setDraft] = useState({ endpoint: '', status: 'all', from: '', to: '', q: '' });
  const [f, setF] = useState(draft);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(
    () => joshErpLogApi.list({ endpoint: f.endpoint || undefined, status: f.status, from: iso(f.from), to: iso(f.to), q: f.q || undefined, page, limit: LIMIT }),
    [f, page],
  );
  const detail = useAsync(() => (open ? joshErpLogApi.get(open) : Promise.resolve(null)), [open]);
  const maxPage = Math.max(1, Math.ceil((data?.total ?? 0) / LIMIT));
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ERP log ของ josh</h1>
          <p>สิ่งที่ ERP ส่งเข้า josh (/api/erp/*) และ josh รับได้หรือไม่ · ค่าเริ่มต้น 24 ชม. ล่าสุด ค้นได้ทีละไม่เกิน 7 วัน · josh เก็บไว้ 14 วัน</p>
        </div>
        <button className="btn ghost" type="button" onClick={reload}>Refresh</button>
      </div>
      <section className="panel">
        <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF(draft); }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field">Endpoint
              <select value={draft.endpoint} onChange={set('endpoint')}>
                <option value="">ทั้งหมด</option>
                {ENDPOINTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
            <label className="field">ผล
              <select value={draft.status} onChange={set('status')}>
                <option value="all">ทั้งหมด</option><option value="ok">สำเร็จ</option><option value="fail">ไม่สำเร็จ</option>
              </select>
            </label>
            <label className="field">ตั้งแต่<input type="datetime-local" value={draft.from} onChange={set('from')} /></label>
            <label className="field">ถึง<input type="datetime-local" value={draft.to} onChange={set('to')} /></label>
            <label className="field">ค้นหา<input value={draft.q} onChange={set('q')} placeholder="รหัสสินค้า / เลข order / รหัสลูกค้า" /></label>
            <button className="btn" type="submit">ค้นหา</button>
          </div>
        </form>
      </section>
      {error && <div className="err">{error}</div>}
      {loading && !data && <div className="empty">Loading…</div>}
      {data && (
        <>
          <p className="hint">{data.total.toLocaleString('th-TH')} รายการ</p>
          <section className="panel">
            {data.items.length ? (
              <table>
                <thead><tr><th>เวลา</th><th>Endpoint</th><th>ผล</th><th>ms</th><th>สรุป</th><th></th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="mono">{new Date(r.createdAt).toLocaleString('th-TH')}</td>
                        <td className="mono">{r.method} {r.endpoint}</td>
                        <td><span className={`badge ${r.isSuccess ? 'ok' : 'danger'}`}>{r.statusCode}</span></td>
                        <td>{r.durationMs}</td>
                        <td>{r.summary ?? '—'}</td>
                        <td><button className="btn ghost sm" type="button" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'ซ่อน' : 'ดู payload'}</button></td>
                      </tr>
                      {open === r.id && (
                        <tr><td colSpan={6}>
                          {detail.error ? <div className="err">{detail.error}</div> : <pre className="payload">{detail.data ? JSON.stringify(detail.data, null, 2) : 'Loading…'}</pre>}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">ไม่มีรายการในช่วงนี้</div>}
          </section>
          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <button className="btn ghost sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
            <span className="hint">หน้า {page} / {maxPage}</span>
            <button className="btn ghost sm" disabled={page >= maxPage || loading} onClick={() => setPage(page + 1)}>ถัดไป</button>
          </div>
        </>
      )}
    </div>
  );
}
