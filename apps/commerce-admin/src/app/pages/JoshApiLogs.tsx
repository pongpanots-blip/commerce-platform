import { Fragment, useState } from 'react';
import { apiLogsApi } from '../../lib/api';
import { useAsync } from '../hooks';

const when = (v: string) => new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' });
const SELECTS = {
  status: ['all', '2xx', '4xx', '5xx'], source: ['all', 'internal', 'jagota', 'kbank', 'erp_webhook'],
  method: ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'], sort: ['newest', 'slowest'],
} as const;

/**
 * josh's general API log (web-admin › API logs), read-only from josh's Mongo with josh's own query
 * code: calls josh served and calls it made to Jagota / KBank. ERP inbound is on "ERP log ของ josh".
 */
export function JoshApiLogs() {
  const [f, setF] = useState<Record<string, string>>({ status: 'all', source: 'all', method: 'all', sort: 'newest', q: '', page: '1' });
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== 'all'));
  const stats = useAsync(() => apiLogsApi.stats(query), [JSON.stringify(query)]);
  const list = useAsync(() => apiLogsApi.list(query), [JSON.stringify(query)]);
  const detail = useAsync(() => (open ? apiLogsApi.detail(open) : Promise.resolve(null)), [open]);
  const set = (k: string, v: string) => setF({ ...f, [k]: v, page: '1' });
  const page = Number(f.page);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1;
  const s = stats.data;
  const max = s ? Math.max(1, ...s.buckets.map((b) => b.count)) : 1;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>API log ของ josh</h1>
          <p>อ่านอย่างเดียวจาก Mongo ของ josh (24 ชม. ล่าสุด, ย้อนได้สูงสุด 7 วัน) · ERP ที่ยิงเข้า josh ดูที่ "ERP log ของ josh"</p>
        </div>
        <button className="btn ghost" onClick={() => { stats.reload(); list.reload(); }}>Refresh</button>
      </div>
      <form className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); set('q', draft.trim()); }}>
        {Object.entries(SELECTS).map(([k, opts]) => (
          <label key={k} className="field">{k}<select value={f[k]} onChange={(e) => set(k, e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>
        ))}
        <label className="field">ค้นใน URL / message<input value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
        <button className="btn" style={{ alignSelf: 'flex-end' }}>ค้นหา</button>
      </form>
      {(stats.error || list.error) && <div className="err">{stats.error || list.error}</div>}
      {s && (
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="hint">จำนวน call ต่อช่วง (แดง = error) · {when(s.from)} – {when(s.to)}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, marginTop: 6 }} aria-label="กราฟจำนวน call">
            {s.buckets.map((b) => (
              <div key={b.start} title={`${when(b.start)} · ${b.count} call · error ${b.errors} · เฉลี่ย ${b.avgMs}ms`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${((b.count - b.errors) / max) * 100}%`, background: 'var(--accent, #4b6bfb)' }} />
                <div style={{ height: `${(b.errors / max) * 100}%`, background: 'var(--danger, #d64545)' }} />
              </div>
            ))}
          </div>
          {!!s.topEndpoints.length && (
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Route ที่ช้าที่สุด</th><th>call</th><th>error</th><th>เฉลี่ย</th><th>สูงสุด</th></tr></thead>
              <tbody>{s.topEndpoints.slice(0, 10).map((t) => (
                <tr key={t.method + t.route}><td className="mono">{t.method} {t.route}</td><td>{t.count}</td><td>{t.errors || '—'}</td><td>{t.avgMs}ms</td><td>{t.maxMs}ms</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}
      {list.data && (
        <section className="panel" style={{ overflowX: 'auto' }}>
          {list.data.items.length ? (
            <table>
              <thead><tr><th>เวลา</th><th>Method</th><th>URL</th><th>Status</th><th>ms</th><th>ที่มา</th><th></th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{when(r.createdAt)}</td><td className="mono">{r.method}</td><td className="mono" style={{ wordBreak: 'break-all' }}>{r.url}</td>
                    <td><span className={`badge ${r.isSuccess ? 'ok' : 'danger'}`}>{r.statusCode}</span></td><td>{r.durationMs}</td><td>{r.source}</td>
                    <td><button className="btn ghost sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'ซ่อน' : 'ดู'}</button></td>
                  </tr>
                  {open === r.id && <tr><td colSpan={7}>{detail.error ? <div className="err">{detail.error}</div> : !detail.data ? 'Loading…' : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {detail.data.errorMessage && <div className="err">{detail.data.errorMessage}</div>}
                      {!!detail.data.steps.length && <div className="hint">{detail.data.steps.map((st) => `${st.label} ${st.ms}ms`).join(' · ')}</div>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div><div className="hint">request</div><pre className="payload">{JSON.stringify({ query: detail.data.query, payload: detail.data.payload }, null, 2)}</pre></div>
                        <div><div className="hint">response</div><pre className="payload">{JSON.stringify(detail.data.response, null, 2) ?? '—'}</pre></div>
                      </div>
                    </div>)}</td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          ) : <div className="empty">ไม่มี log ในช่วงนี้</div>}
        </section>
      )}
      {list.data && list.data.total > list.data.limit && (
        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setF({ ...f, page: String(page - 1) })}>ก่อนหน้า</button>
          <span className="hint">หน้า {page} / {pages}</span>
          <button className="btn ghost sm" disabled={page >= pages} onClick={() => setF({ ...f, page: String(page + 1) })}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}
