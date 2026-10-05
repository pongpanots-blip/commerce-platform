import { FormEvent, Fragment, useState } from 'react';
import { joshActionsApi, joshProductApi, ProductIssueKey } from '../../lib/api';
import { useAsync } from '../hooks';

const ISSUES: [ProductIssueKey, string][] = [
  ['pending_approval', 'รออนุมัติข้อมูลจาก ERP'], ['no_image', 'ไม่มีรูป'], ['no_category', 'ไม่มีหมวด'],
  ['no_price', 'ไม่มีราคาขาย'], ['out_of_stock', 'หมด'], ['low_stock', 'ใกล้หมด'],
];
const STATUS: Record<string, string> = { active: 'เปิดขาย', draft: 'draft (ยังไม่เปิด)', inactive: 'ปิด' };
const baht = (n: number | null) => (n == null ? '—' : '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }));
const LIMIT = 50;
const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** josh's product catalog, read-only from josh's replica. Editing, ERP approval and images stay in josh admin. */
export function JoshProducts() {
  const summary = useAsync(() => joshProductApi.summary(), []);
  const categories = useAsync(() => joshProductApi.categories(), []);
  const [draft, setDraft] = useState({ search: '', status: '', categoryId: '', orderTaking: '' });
  const [f, setF] = useState({ ...draft, issue: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useAsync(() => joshProductApi.list({ ...f, page, limit: LIMIT }), [f, page]);
  const detail = useAsync(() => (open ? joshProductApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const maxPage = Math.max(1, Math.ceil((list.data?.total ?? 0) / LIMIT));
  const pickIssue = (issue: string) => { setPage(1); setF({ ...f, issue: f.issue === issue ? '' : issue }); };
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const togglePick = (id: string) => { const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id); setPicked(next); };
  /** Approve / reject staged ERP changes — josh applies them with its own ProductService. */
  async function decide(action: 'approve' | 'reject', ids: string[]) {
    const verb = action === 'approve' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    if (!ids.length || !window.confirm(`${verb}ข้อมูลจาก ERP ของสินค้า ${ids.length} รายการ?\n\n${action === 'approve' ? 'สินค้า draft จะขึ้นขาย และค่าที่ ERP ส่งมาจะใช้ทันที' : 'ค่าที่ ERP ส่งมาจะถูกทิ้ง สินค้าคงค่าเดิม'} (josh ทำในชื่อบัญชี josh ที่อีเมลตรงกับคุณ)`)) return;
    setBusy(true); setMsg('');
    try {
      const r = action === 'approve' ? await joshActionsApi.approveProducts(ids) : await joshActionsApi.rejectProducts(ids);
      setMsg(`${verb}แล้ว: ${JSON.stringify(r)}`); setPicked(new Set()); summary.reload(); list.reload(); detail.reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const pending = (p: { product_status: string; erp_pending_at: string | null }) => p.product_status === 'draft' || !!p.erp_pending_at;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>สินค้า (josh)</h1>
          <p>แค็ตตาล็อกหน้าร้าน อ่านจาก replica ของ josh · <b>อนุมัติ / ไม่อนุมัติข้อมูลจาก ERP ทำที่นี่ได้</b> (josh เป็นคนบันทึก) · แก้ไขอื่นๆ / ใส่รูป ยังทำที่ josh admin</p>
        </div>
        <button className="btn ghost" onClick={() => { summary.reload(); list.reload(); }}>Refresh</button>
      </div>
      {(summary.error || list.error) && <div className="err">{summary.error || list.error}</div>}
      {msg && <div className="hint" style={{ marginBottom: 8 }}>{msg}</div>}

      {s && (
        <div className="stat-grid">
          <div className="stat"><div className="label">สินค้าทั้งหมด</div><div className="value">{s.total}</div>
            <div className="hint">{s.byStatus.map((b) => `${STATUS[b.status] ?? b.status} ${b.n}`).join(' · ')}</div></div>
          {ISSUES.map(([k, label]) => (
            <button key={k} type="button" className="stat" onClick={() => pickIssue(k)} aria-pressed={f.issue === k}
              style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', borderColor: f.issue === k ? 'var(--accent)' : undefined }}>
              <div className="label">{label}</div><div className={`value${s[k] ? ' attn' : ''}`}>{s[k]}</div>
            </button>
          ))}
        </div>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF({ ...draft, issue: f.issue }); }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field">ค้นหา<input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="SKU หรือชื่อสินค้า" /></label>
            <label className="field">สถานะ
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                <option value="">ทั้งหมด</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field">หมวด
              <select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                <option value="">ทั้งหมด</option>{(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.category_path ?? c.category_name_th}</option>)}
              </select>
            </label>
            <label className="field">แบบสั่งจอง (order taking)
              <select value={draft.orderTaking} onChange={(e) => setDraft({ ...draft, orderTaking: e.target.value })}>
                <option value="">ทั้งหมด</option><option value="Y">ใช่</option><option value="N">ไม่ใช่</option>
              </select>
            </label>
            <button className="btn" type="submit">ค้นหา</button>
          </div>
          {f.issue && <div className="hint">กรอง: {ISSUES.find(([k]) => k === f.issue)?.[1]} · <button type="button" className="btn ghost sm" onClick={() => pickIssue(f.issue)}>ล้าง</button></div>}
        </form>
      </section>

      {list.data && (
        <>
          <div className="row" style={{ alignItems: 'center' }}>
            <p className="hint">{list.data.total.toLocaleString('th-TH')} รายการ</p>
            {picked.size > 0 && <>
              <button className="btn sm" disabled={busy} onClick={() => decide('approve', [...picked])}>อนุมัติที่เลือก ({picked.size})</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => decide('reject', [...picked])}>ไม่อนุมัติที่เลือก</button>
            </>}
          </div>
          <section className="panel">
            {list.data.items.length ? (
              <table>
                <thead><tr><th aria-label="เลือก"></th><th></th><th>SKU</th><th>สินค้า</th><th>หมวด</th><th>ราคาขาย</th><th>สต็อก</th><th>สถานะ</th><th></th></tr></thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <Fragment key={p.product_inventory_id}>
                      <tr>
                        <td>{pending(p) && <input type="checkbox" aria-label={`เลือก ${p.product_inventory_sku}`} checked={picked.has(p.product_inventory_id)} onChange={() => togglePick(p.product_inventory_id)} />}</td>
                        <td style={{ width: 52 }}>{p.image_url ? <img src={p.image_url} alt="" width={40} height={40} style={{ objectFit: 'cover', borderRadius: 4 }} /> : <span className="badge warn">ไม่มีรูป</span>}</td>
                        <td className="mono">{p.product_inventory_sku}</td>
                        <td>{p.name_th ?? p.name_en ?? '—'}<div className="hint">{[p.brand_name, p.pack_size, p.selling_unit].filter(Boolean).join(' · ')}</div></td>
                        <td>{p.category_name_th ?? <span className="badge warn">ไม่มีหมวด</span>}</td>
                        <td>{p.selling_unit_price ? baht(p.selling_unit_price) : <span className="badge danger">ไม่มีราคา</span>}</td>
                        <td>{p.order_taking_flag === 'Y' ? <span className="badge">สั่งจอง</span> : p.product_inventory_quantity ?? '—'}</td>
                        <td><span className={`badge ${p.product_status === 'active' ? 'ok' : 'muted'}`}>{STATUS[p.product_status] ?? p.product_status}</span>
                          {p.erp_pending_at && <div><span className="badge warn">ERP รออนุมัติ ({p.erp_pending_source})</span></div>}</td>
                        <td><button type="button" className="btn ghost sm" onClick={() => setOpen(open === p.product_inventory_id ? null : p.product_inventory_id)}>{open === p.product_inventory_id ? 'ซ่อน' : 'รายละเอียด'}</button></td>
                      </tr>
                      {open === p.product_inventory_id && (
                        <tr><td colSpan={9}>
                          {detail.error ? <div className="err">{detail.error}</div> : !detail.data ? 'Loading…' : (
                            <div style={{ display: 'grid', gap: 12 }}>
                              <div className="row">
                                {detail.data.media.map((m) => <img key={m.source} src={m.source} alt="" width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />)}
                              </div>
                              <div className="hint">
                                ราคา: ขาย {baht(detail.data.selling_unit_price)} · สั่ง {baht(detail.data.ordering_price)} · ตั้ง {baht(detail.data.original_price)} · MOQ {show(detail.data.moq)} ·
                                {' '}supplier {show(detail.data.sup_code)} · เก็บ {show(detail.data.storage_temperature)} · ประเทศ {show(detail.data.country_code_source)} · VAT {show(detail.data.vat_type)}
                              </div>
                              {!!detail.data.pendingChanges.length && (
                                <div>
                                  <div className="row" style={{ alignItems: 'center' }}>
                                    <div className="hint">ERP ส่งมาเมื่อ {new Date(detail.data.erp_pending_at!).toLocaleString('th-TH')} — รออนุมัติ:</div>
                                    <button className="btn sm" disabled={busy} onClick={() => decide('approve', [p.product_inventory_id])}>อนุมัติ</button>
                                    <button className="btn ghost sm" disabled={busy} onClick={() => decide('reject', [p.product_inventory_id])}>ไม่อนุมัติ</button>
                                  </div>
                                  <table>
                                    <thead><tr><th>ฟิลด์ ERP</th><th>ตอนนี้</th><th>ERP ส่งมา</th></tr></thead>
                                    <tbody>{detail.data.pendingChanges.map((c) => (
                                      <tr key={c.field}><td className="mono">{c.field}</td><td>{show(c.current)}</td>
                                        <td>{c.changed ? <strong>{show(c.pending)}</strong> : show(c.pending)}{c.changed && <span className="badge warn" style={{ marginLeft: 6 }}>เปลี่ยน</span>}</td></tr>
                                    ))}</tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">ไม่พบสินค้า</div>}
          </section>
          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
            <span className="hint">หน้า {page} / {maxPage}</span>
            <button className="btn ghost sm" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>ถัดไป</button>
          </div>
        </>
      )}
    </div>
  );
}
