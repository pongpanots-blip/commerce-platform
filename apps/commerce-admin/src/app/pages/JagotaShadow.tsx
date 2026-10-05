import { Fragment, useState } from 'react';
import { jagotaGatewayApi, jagotaShadowApi } from '../../lib/api';
import { useAsync } from '../hooks';

const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));
const when = (v: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/**
 * Step 1 of "orders reach Jagota through commerce": josh keeps sending as today; commerce rebuilds
 * each request josh sent and records whether its own would have been identical. Nothing is sent.
 */
export function JagotaShadow() {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState('mismatched');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const summary = useAsync(() => jagotaShadowApi.summary(days), [days]);
  const list = useAsync(() => jagotaShadowApi.list(filter, page), [filter, page]);
  const detail = useAsync(() => (open ? jagotaShadowApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const refresh = () => { summary.reload(); list.reload(); };

  async function act(label: string, fn: () => Promise<unknown>, done: (r: never) => string) {
    setBusy(label); setMsg('');
    try { setMsg(done((await fn()) as never)); refresh(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ส่ง order ผ่าน commerce · ทดลองคู่กัน</h1>
          <p>josh ยังส่ง order ไป Jagota เหมือนเดิม · commerce สร้าง request ของ order เดียวกันแล้วเทียบกับที่ josh ส่งจริงทีละช่อง · <b>ไม่ส่งอะไรไป ERP</b></p>
        </div>
        <div className="row">
          <button className="btn" disabled={!!busy} onClick={() => act('run', jagotaShadowApi.run, (r: { checked: number }) => `ตรวจเพิ่ม ${r.checked} รายการ`)}>{busy === 'run' ? 'กำลังตรวจ…' : 'ตรวจตอนนี้'}</button>
          <button className="btn ghost" onClick={refresh}>Refresh</button>
        </div>
      </div>
      {msg && <div className="hint" style={{ marginBottom: 8 }}>{msg}</div>}
      {(summary.error || list.error) && <div className="err">{summary.error || list.error}</div>}
      {s && (
        <div className="stat-grid">
          <div className="stat"><div className="label">ตรง ({days} วัน)</div><div className="value">{s.matchRate == null ? '—' : `${s.matchRate}%`}</div><div className="hint">{s.matched} / {s.checked} รายการ</div></div>
          <div className="stat"><div className="label">ไม่ตรง</div><div className={`value${s.mismatched ? ' attn' : ''}`}>{s.mismatched}</div></div>
          <div className="stat"><div className="label">commerce สร้างไม่ได้</div><div className={`value${s.could_not_build ? ' attn' : ''}`}>{s.could_not_build}</div></div>
          <div className="stat"><div className="label">ช่วงที่ตรวจ</div><div className="hint" style={{ marginTop: 10 }}>{when(s.first_at)} – {when(s.last_at)}</div>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ marginTop: 6 }}>{[1, 7, 30].map((d) => <option key={d} value={d}>{d} วัน</option>)}</select></div>
        </div>
      )}
      {!!s?.topFields.length && <p className="hint" style={{ marginTop: 8 }}>ช่องที่ต่างบ่อย: {s.topFields.map((f) => `${f.field} (${f.n})`).join(' · ')}</p>}
      <div className="row" role="tablist" style={{ margin: '12px 0' }}>
        {[['mismatched', 'ไม่ตรง / สร้างไม่ได้'], ['matched', 'ตรง'], ['all', 'ทั้งหมด']].map(([k, label]) => (
          <button key={k} className={`btn sm ${filter === k ? '' : 'ghost'}`} aria-selected={filter === k} onClick={() => { setFilter(k); setPage(1); }}>{label}</button>
        ))}
      </div>
      {list.data && (
        <section className="panel">
          {list.data.items.length ? (
            <table>
              <thead><tr><th>Shipment / order</th><th>josh ส่งเมื่อ</th><th>ผล josh</th><th>เทียบ</th><th>ช่องที่ต่าง</th><th></th></tr></thead>
              <tbody>{list.data.items.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td className="mono">{c.orderReference ?? '—'}</td><td>{when(c.joshSentAt)}</td><td>{c.joshSyncStatus}</td>
                    <td><span className={`badge ${c.matched ? 'ok' : 'danger'}`}>{c.matched ? 'ตรง' : 'ไม่ตรง'}</span></td>
                    <td>{c.diffs.map((d) => d.path).join(', ') || c.note || '—'}{c.note && c.diffs.length > 0 && <div className="hint">{c.note}</div>}</td>
                    <td className="row">
                      <button className="btn ghost sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'ซ่อน' : 'ดู'}</button>
                      <button className="btn ghost sm" disabled={!!busy} onClick={() => act(c.joshSyncId, () => jagotaShadowApi.recheck(c.joshSyncId), (r: { matched: boolean }) => `ตรวจซ้ำ: ${r.matched ? 'ตรง' : 'ยังไม่ตรง'}`)}>ตรวจซ้ำ</button>
                    </td>
                  </tr>
                  {open === c.id && <tr><td colSpan={6}>{detail.error ? <div className="err">{detail.error}</div> : !detail.data ? 'Loading…' : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {!!detail.data.diffs.length && (
                        <table><thead><tr><th>ช่อง</th><th>josh ส่ง</th><th>commerce จะส่ง</th></tr></thead>
                          <tbody>{detail.data.diffs.map((d) => <tr key={d.path}><td className="mono">{d.path}</td><td className="mono">{show(d.josh)}</td><td className="mono">{show(d.commerce)}</td></tr>)}</tbody></table>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div><div className="hint">josh ส่งไป Jagota</div><pre className="payload">{JSON.stringify(detail.data.joshRequest, null, 2)}</pre></div>
                        <div><div className="hint">commerce จะส่ง</div><pre className="payload">{JSON.stringify(detail.data.commerceRequest, null, 2) ?? '—'}</pre></div>
                      </div>
                    </div>)}</td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          ) : <div className="empty">{filter === 'mismatched' ? 'ไม่มีรายการที่ไม่ตรง' : 'ยังไม่มีรายการ'}</div>}
        </section>
      )}
      {list.data && list.data.total > 50 && (
        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
          <span className="hint">หน้า {page} / {Math.ceil(list.data.total / 50)}</span>
          <button className="btn ghost sm" disabled={page >= Math.ceil(list.data.total / 50)} onClick={() => setPage(page + 1)}>ถัดไป</button>
        </div>
      )}
      <GatewaySends />
    </div>
  );
}

/**
 * Step 2: orders josh routes through commerce (josh JAGOTA_VIA_COMMERCE_BRANCHES) — what commerce
 * sent to Jagota, one row per order reference. Empty until josh routes a branch here.
 */
function GatewaySends() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAsync(() => jagotaGatewayApi.summary(7), []);
  const list = useAsync(() => jagotaGatewayApi.list(status, 1), [status]);
  const detail = useAsync(() => (open ? jagotaGatewayApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  return (
    <section style={{ marginTop: 28 }}>
      <div className="page-head">
        <div>
          <h2>ส่งจริงผ่าน commerce</h2>
          <p>order ของ branch ที่ josh เปิดให้ส่งผ่าน commerce (<span className="mono">JAGOTA_VIA_COMMERCE_BRANCHES</span>) · commerce ส่งไป Jagota แทน josh · ส่งซ้ำไม่ได้ (1 แถวต่อเลข order)
            {s && <> · สถานะฝั่ง commerce: <span className={`badge ${s.enabled ? 'ok' : ''}`}>{s.enabled ? 'เปิด' : 'ปิด (josh ส่งเอง)'}</span></>}</p>
        </div>
      </div>
      {(summary.error || list.error) && <div className="err">{summary.error || list.error}</div>}
      {s && (
        <div className="stat-grid">
          <div className="stat"><div className="label">ส่งสำเร็จ (7 วัน)</div><div className="value">{s.sent}</div><div className="hint">จาก {s.total} รายการ</div></div>
          <div className="stat"><div className="label">ล้มเหลว</div><div className={`value${s.failed ? ' attn' : ''}`}>{s.failed}</div><div className="hint">josh จะลองใหม่เอง</div></div>
          <div className="stat"><div className="label">ส่งมากกว่า 1 ครั้ง</div><div className="value">{s.retried}</div></div>
          <div className="stat"><div className="label">เวลาเฉลี่ย</div><div className="value">{s.avg_ms == null ? '—' : `${(s.avg_ms / 1000).toFixed(1)}s`}</div><div className="hint">ล่าสุด {when(s.last_at)}</div></div>
        </div>
      )}
      <div className="row" role="tablist" style={{ margin: '12px 0' }}>
        {[['', 'ทั้งหมด'], ['failed', 'ล้มเหลว'], ['sent', 'สำเร็จ'], ['sending', 'กำลังส่ง']].map(([k, label]) => (
          <button key={k} className={`btn sm ${status === k ? '' : 'ghost'}`} aria-selected={status === k} onClick={() => setStatus(k)}>{label}</button>
        ))}
      </div>
      {list.data && (
        <section className="panel">
          {list.data.items.length ? (
            <table>
              <thead><tr><th>Shipment / order</th><th>สถานะ</th><th>ครั้ง</th><th>DOC</th><th>เวลา</th><th>ล่าสุด</th><th>ข้อผิดพลาด</th><th></th></tr></thead>
              <tbody>{list.data.items.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="mono">{r.orderReference}</td>
                    <td><span className={`badge ${r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'danger' : ''}`}>{r.status}</span></td>
                    <td>{r.attempts}</td><td className="mono">{r.docNo ? `${r.docBook}/${r.docNo}` : '—'}</td>
                    <td>{r.durationMs == null ? '—' : `${(r.durationMs / 1000).toFixed(1)}s`}</td><td>{when(r.updatedAt)}</td><td>{r.lastError ?? '—'}</td>
                    <td><button className="btn ghost sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'ซ่อน' : 'ดู'}</button></td>
                  </tr>
                  {open === r.id && <tr><td colSpan={8}>{detail.error ? <div className="err">{detail.error}</div> : !detail.data ? 'Loading…' : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div><div className="hint">ส่งไป Jagota</div><pre className="payload">{JSON.stringify(detail.data.request, null, 2)}</pre></div>
                      <div><div className="hint">Jagota ตอบ</div><pre className="payload">{JSON.stringify(detail.data.response, null, 2) ?? '—'}</pre></div>
                    </div>)}</td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          ) : <div className="empty">ยังไม่มี order ที่ส่งผ่าน commerce</div>}
        </section>
      )}
    </section>
  );
}
