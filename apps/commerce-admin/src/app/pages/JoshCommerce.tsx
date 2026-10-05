import { FormEvent, Fragment, ReactNode, useState } from 'react';
import { JoshRow, joshCustomerApi, joshOrderApi, joshPriceApi } from '../../lib/api';
import { useAsync } from '../hooks';

const baht = (n: unknown) => (n == null ? '—' : '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }));
const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const LIMIT = 50;

function Head({ title, sub, onRefresh }: { title: string; sub: string; onRefresh: () => void }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1><p>{sub}</p></div>
      <button className="btn ghost" onClick={onRefresh}>Refresh</button>
    </div>
  );
}

/** Clickable issue tiles: one active at a time, click again to clear. */
function Tiles({ tiles, active, onPick }: { tiles: { key: string; label: string; value: ReactNode; attn?: boolean }[]; active: string; onPick: (k: string) => void }) {
  return (
    <div className="stat-grid">
      {tiles.map((t) => (
        <button key={t.key} type="button" className="stat" aria-pressed={active === t.key} onClick={() => onPick(active === t.key ? '' : t.key)}
          style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', borderColor: active === t.key ? 'var(--accent)' : undefined }}>
          <div className="label">{t.label}</div><div className={`value${t.attn ? ' attn' : ''}`}>{t.value}</div>
        </button>
      ))}
    </div>
  );
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (p: number) => void }) {
  const max = Math.max(1, Math.ceil(total / LIMIT));
  return (
    <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
      <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
      <span className="hint">หน้า {page} / {max} · {total.toLocaleString('th-TH')} รายการ</span>
      <button className="btn ghost sm" disabled={page >= max} onClick={() => setPage(page + 1)}>ถัดไป</button>
    </div>
  );
}

const ORDER_STATUS: Record<string, string> = { payment_pending: 'รอชำระ', paid: 'ชำระแล้ว', preparing: 'กำลังเตรียม', shipped: 'จัดส่งแล้ว', delivered: 'ส่งถึงแล้ว', cancelled: 'ยกเลิก', refunded: 'คืนเงิน' };
const SYNC: Record<string, [string, string]> = { sent: ['ส่งแล้ว', 'ok'], confirmed: ['ยืนยันแล้ว', 'ok'], reserved: ['จองแล้ว', 'ok'], skipped: ['ข้าม', 'muted'], pending: ['รอส่ง', 'warn'], failed: ['ส่งไม่สำเร็จ', 'danger'] };
function SyncBadge({ s }: { s: string | null }) {
  if (!s) return <span className="badge muted">ยังไม่ส่ง</span>;
  const [label, cls] = SYNC[s] ?? [s, 'muted'];
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** josh orders, read-only: status, payment, and whether each reached Jagota. Orders are still created, paid and sent by josh. */
export function JoshOrdersPage() {
  const [draft, setDraft] = useState({ search: '', status: '', from: '', to: '' });
  const [f, setF] = useState({ ...draft, sync: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAsync(() => joshOrderApi.summary({ ...f, sync: undefined }), [f.search, f.status, f.from, f.to]);
  // The 'payment_missing' tile filters by payment, not by Jagota state.
  const list = useAsync(() => joshOrderApi.list({ ...f, ...(f.sync === 'payment_missing' ? { sync: '', payment: 'missing' } : {}), page, limit: LIMIT }), [f, page]);
  const detail = useAsync(() => (open ? joshOrderApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const d = detail.data;
  return (
    <div>
      <Head title="Orders (josh)" sub="ออเดอร์หน้าร้าน · ส่งถึง Jagota (ERP) แล้วหรือยัง · ดูอย่างเดียว อ่านจาก replica ของ josh" onRefresh={() => { summary.reload(); list.reload(); }} />
      {(summary.error || list.error) && <div className="err">{summary.error || list.error}</div>}
      {s && <Tiles active={f.sync} onPick={(k) => { setPage(1); setF({ ...f, sync: k }); }} tiles={[
        { key: 'failed', label: 'ส่ง Jagota ไม่สำเร็จ', value: s.sync_failed, attn: s.sync_failed > 0 },
        { key: 'not_sent', label: 'จ่ายแล้วแต่ยังไม่ส่ง Jagota', value: s.sync_not_sent, attn: s.sync_not_sent > 0 },
        { key: 'pending', label: 'รอส่ง Jagota', value: s.sync_pending },
        { key: 'sent', label: 'ส่ง Jagota แล้ว', value: s.sync_sent },
        { key: 'payment_missing', label: 'สถานะจ่ายแล้ว/ส่งแล้ว แต่ไม่มีการจ่ายสำเร็จ', value: s.settled_without_payment, attn: s.settled_without_payment > 0 },
      ]} />}
      {s && <p className="hint" style={{ marginTop: 8 }}>ทั้งหมด {s.total.toLocaleString('th-TH')} · รอชำระ {s.awaiting_payment} · มูลค่าที่ชำระแล้ว {baht(s.paid_value)} · {s.byStatus.map((b: JoshRow) => `${ORDER_STATUS[b.status] ?? b.status} ${b.n}`).join(' · ')}</p>}
      <section className="panel" style={{ marginTop: 12 }}>
        <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF({ ...draft, sync: f.sync }); }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field">ค้นหา<input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="เลข order / รหัสลูกค้า / PO / บริษัท" /></label>
            <label className="field">สถานะ<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">ทั้งหมด</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">ตั้งแต่<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
            <label className="field">ถึงก่อน<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
            <button className="btn" type="submit">ค้นหา</button>
          </div>
        </form>
      </section>
      {list.data && (
        <>
          <section className="panel">
            <table>
              <thead><tr><th>Order</th><th>ลูกค้า</th><th>ยอด</th><th>สถานะ</th><th>ชำระ</th><th>Jagota</th><th></th></tr></thead>
              <tbody>{list.data.items.map((o) => (
                <Fragment key={o.orders_id}>
                  <tr>
                    <td className="mono">{o.order_number}<div className="hint">{when(o.create_date)}</div></td>
                    <td>{o.company_name ?? '—'}<div className="hint">{o.branch_name} · {o.customer_code}</div></td>
                    <td>{baht(o.total_price)}</td>
                    <td>{ORDER_STATUS[o.status] ?? o.status}</td>
                    <td>{o.payment_status ?? '—'}</td>
                    <td><SyncBadge s={o.jagota_sync_status} />{o.jagota_error && <div className="hint" style={{ color: 'var(--danger)' }}>{o.jagota_error}</div>}{o.doc_no && <div className="hint mono">{o.doc_book}{o.doc_no}</div>}</td>
                    <td><button className="btn ghost sm" onClick={() => setOpen(open === o.orders_id ? null : o.orders_id)}>{open === o.orders_id ? 'ซ่อน' : 'รายละเอียด'}</button></td>
                  </tr>
                  {open === o.orders_id && <tr><td colSpan={7}>{detail.error ? <div className="err">{detail.error}</div> : !d ? 'Loading…' : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div className="hint">ส่ง {d.delivery_date ?? '—'} · สั่งโดย {d.orderedBy.name.first_name} {d.orderedBy.name.last_name ?? ''} ({d.orderedBy.email ?? d.orderedBy.phone ?? '—'}) · ก่อน VAT {baht(d.subtotal_ex_vat)} · VAT {baht(d.vat_amount)} · ส่วนลด {baht(d.discount_inc_vat)} · ค่าส่ง {baht(d.delivery_fee)}</div>
                      <table><thead><tr><th>SKU</th><th>สินค้า</th><th>จำนวน</th><th>ราคา/หน่วย</th><th>ที่มาราคา</th><th>รวม</th></tr></thead>
                        <tbody>{d.items.map((i: JoshRow) => <tr key={i.sku}><td className="mono">{i.sku}</td><td>{i.name}</td><td>{i.qty}</td><td>{baht(i.unit_price)}</td><td>{i.price_source}</td><td>{baht(i.line_revenue)}</td></tr>)}</tbody></table>
                      <div className="hint">Jagota: {d.jagotaSync.length ? d.jagotaSync.map((j: JoshRow) => `${when(j.created_at)} ${j.sync_status}${j.doc_no ? ` ${j.doc_book}${j.doc_no}` : ''}${j.error_message ? ` (${j.error_message})` : ''}`).join(' → ') : 'ยังไม่เคยส่ง'}</div>
                      <div className="hint">Shipment: {d.shipments.map((sh: JoshRow) => `${sh.shipment_number} ${sh.delivered_at ? 'ส่งถึง' : sh.shipped_at ? 'ออกส่ง' : 'รอ'}`).join(' · ') || '—'} · ชำระ: {d.payments.map((p: JoshRow) => `${p.status} ${baht(p.amount)} ${p.payment_method ?? ''}`).join(' · ') || '—'}</div>
                    </div>)}</td></tr>}
                </Fragment>
              ))}</tbody>
            </table>
          </section>
          <Pager page={page} total={list.data.total} setPage={setPage} />
        </>
      )}
    </div>
  );
}

const KYC: Record<string, [string, string]> = { none: ['ไม่มีเอกสาร', 'muted'], pending: ['รอตรวจ', 'warn'], approved: ['ผ่าน', 'ok'], rejected: ['ไม่ผ่าน', 'danger'] };

/** josh business customers, read-only and masked like josh winback. */
export function JoshCustomersPage() {
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ search: '', issue: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAsync(() => joshCustomerApi.summary(), []);
  const list = useAsync(() => joshCustomerApi.list({ ...f, page, limit: LIMIT }), [f, page]);
  const detail = useAsync(() => (open ? joshCustomerApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const d = detail.data;
  return (
    <div>
      <Head title="ลูกค้า / บริษัท (josh)" sub="บริษัท สาขา วงเงิน และ KYC · ข้อมูลส่วนบุคคลถูกปิดบังแบบเดียวกับ josh · ดูอย่างเดียว" onRefresh={() => { summary.reload(); list.reload(); }} />
      {(summary.error || list.error) && <div className="err">{summary.error || list.error}</div>}
      {s && <Tiles active={f.issue} onPick={(k) => { setPage(1); setF({ ...f, issue: k }); }} tiles={[
        { key: 'kyc_pending', label: 'KYC รอตรวจ', value: s.kyc_pending, attn: s.kyc_pending > 0 },
        { key: 'kyc_none', label: 'ยังไม่ส่ง KYC', value: s.kyc_none },
        { key: 'credit_application_pending', label: 'ขอวงเงินค้าง', value: s.credit_application_pending, attn: s.credit_application_pending > 0 },
        { key: 'over_credit', label: 'เกินวงเงิน', value: s.over_credit, attn: s.over_credit > 0 },
        { key: 'near_credit', label: 'ใกล้เต็มวงเงิน (≥90%)', value: s.near_credit },
        { key: 'no_erp_code', label: 'ไม่มีรหัสลูกค้า ERP', value: s.no_erp_code, attn: s.no_erp_code > 0 },
      ]} />}
      {s && <p className="hint" style={{ marginTop: 8 }}>{s.total} บริษัท · ใช้วงเงินรวม {baht(s.credit_used_total)} / {baht(s.credit_limit_total)}</p>}
      <section className="panel" style={{ marginTop: 12 }}>
        <form className="row" style={{ padding: 12 }} onSubmit={(e) => { e.preventDefault(); setPage(1); setF({ ...f, search: search.trim() }); }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ชื่อบริษัท หรือรหัสลูกค้า ERP" style={{ flex: 1 }} />
          <button className="btn" type="submit">ค้นหา</button>
        </form>
      </section>
      {list.data && (
        <>
          <section className="panel">
            <table>
              <thead><tr><th>บริษัท</th><th>รหัส ERP</th><th>วงเงิน</th><th>เครดิต</th><th>สาขา / คน</th><th>KYC</th><th>สั่งล่าสุด</th><th></th></tr></thead>
              <tbody>{list.data.items.map((c) => {
                const over = c.credit_limit > 0 && c.credit_used > c.credit_limit;
                const [kl, kc] = KYC[c.kyc_status] ?? [c.kyc_status, 'muted'];
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td>{c.name}<div className="hint mono">{c.register_number}</div></td>
                      <td className="mono">{c.erp_customer_code ?? <span className="badge warn">ไม่มี</span>}</td>
                      <td>{baht(c.credit_used)} / {baht(c.credit_limit)}{over && <div><span className="badge danger">เกินวงเงิน</span></div>}</td>
                      <td>{c.credit_term_days ? `${c.credit_term_days} วัน` : 'เงินสด'}</td>
                      <td>{c.branch_count} / {c.user_count}</td>
                      <td><span className={`badge ${kc}`}>{kl}</span></td>
                      <td>{when(c.last_order_at)}</td>
                      <td><button className="btn ghost sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'ซ่อน' : 'รายละเอียด'}</button></td>
                    </tr>
                    {open === c.id && <tr><td colSpan={8}>{detail.error ? <div className="err">{detail.error}</div> : !d ? 'Loading…' : (
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div className="hint">โทร {d.phone ?? '—'} · ออเดอร์ {d.orders?.orders ?? 0} รายการ · ยอดที่ชำระแล้ว {baht(d.orders?.paid_value)}</div>
                        <table><thead><tr><th>สาขา</th><th>รหัส ERP</th><th>sync</th><th>วันส่ง</th><th>โทร</th></tr></thead>
                          <tbody>{d.branches.map((b: JoshRow) => <tr key={b.id}><td>{b.name}{b.is_default_delivery && <span className="badge" style={{ marginLeft: 6 }}>หลัก</span>}</td><td className="mono">{b.erp_branch_code ?? '—'}</td><td>{b.erp_sync_status ?? '—'}</td><td>{b.delivery_days ?? '—'}</td><td>{b.phone ?? '—'}</td></tr>)}</tbody></table>
                        <table><thead><tr><th>ผู้ใช้</th><th>อีเมล</th><th>โทร</th><th>role</th><th>เข้าแอปล่าสุด</th></tr></thead>
                          <tbody>{d.users.map((u: JoshRow) => <tr key={u.id}><td>{u.first_name} {u.last_name ?? ''}{!u.is_active && <span className="badge muted" style={{ marginLeft: 6 }}>ปิด</span>}</td><td>{u.email ?? '—'}</td><td>{u.mobile_phone ?? '—'}</td><td>{u.role}</td><td>{when(u.last_app_login_at)}</td></tr>)}</tbody></table>
                        <div className="hint">KYC: {d.kycDocuments.map((k: JoshRow) => `${k.document_type} ${KYC[k.status]?.[0] ?? k.status}${k.rejection_reason ? ` (${k.rejection_reason})` : ''}`).join(' · ') || 'ยังไม่มีเอกสาร'}</div>
                        <div className="hint">ขอวงเงิน: {d.creditApplications.map((a: JoshRow) => `${a.status} ขอ ${baht(a.requested_credit_limit)} / ${a.requested_term_days} วัน${a.approved_credit_limit ? ` → อนุมัติ ${baht(a.approved_credit_limit)}` : ''}`).join(' · ') || '—'}</div>
                      </div>)}</td></tr>}
                  </Fragment>
                );
              })}</tbody>
            </table>
          </section>
          <Pager page={page} total={list.data.total} setPage={setPage} />
        </>
      )}
    </div>
  );
}

const SOURCE: Record<string, string> = { customer_sku: 'ราคาเฉพาะบริษัท', contract_sku: 'ราคาสัญญาสาขา', promotion: 'ราคาพิเศษสาขา', promotion_mechanic: 'โปรโมชัน', base: 'ราคาปกติ' };
const rowsText = (rows: JoshRow[]) => rows.map((r) => `${baht(r.price)} (${r.start_date ?? '…'} – ${r.end_date ?? '…'})`).join(', ') || '—';

/** What a josh customer branch pays per unit today, layer by layer in josh's order, plus its ERP quotations. */
export function JoshPricesPage() {
  const [branchSearch, setBranchSearch] = useState('');
  const [bq, setBq] = useState('');
  const branches = useAsync(() => joshPriceApi.branches(bq), [bq]);
  const [branch, setBranch] = useState<JoshRow | null>(null);
  const [sku, setSku] = useState('');
  const [skuQ, setSkuQ] = useState('');
  const prices = useAsync(() => (branch ? joshPriceApi.forBranch(branch.branch_id, skuQ) : Promise.resolve(null)), [branch?.branch_id, skuQ]);
  const quotes = useAsync(() => (branch?.erp_customer_code ? joshPriceApi.quotations(branch.erp_customer_code) : Promise.resolve([])), [branch?.erp_customer_code]);
  return (
    <div>
      <Head title="ราคาที่ลูกค้าเห็น (josh)" sub="เลือกสาขา → ราคาต่อหน่วยที่ josh คิดวันนี้ ทีละชั้นตามลำดับของ josh และ quotation จาก ERP · ดูอย่างเดียว" onRefresh={() => { branches.reload(); prices.reload(); quotes.reload(); }} />
      <section className="panel">
        <form className="row" style={{ padding: 12 }} onSubmit={(e) => { e.preventDefault(); setBq(branchSearch.trim()); }}>
          <input value={branchSearch} onChange={(e) => setBranchSearch(e.target.value)} placeholder="ค้นหาบริษัท / สาขา / รหัสลูกค้า ERP" style={{ flex: 1 }} />
          <button className="btn" type="submit">ค้นหาสาขา</button>
        </form>
        {branches.error && <div className="err" style={{ padding: '0 12px' }}>{branches.error}</div>}
        <div className="row" style={{ padding: '0 12px 12px' }}>
          {(branches.data ?? []).slice(0, 30).map((b) => (
            <button key={b.branch_id} type="button" className={`btn sm ${branch?.branch_id === b.branch_id ? '' : 'ghost'}`} onClick={() => setBranch(b)}>
              {b.company_name ?? '—'} · {b.branch_name}
            </button>
          ))}
        </div>
      </section>
      {branch && (
        <>
          <section className="panel">
            <div className="panel-head">{branch.company_name} · {branch.branch_name} <span className="mono hint">{branch.erp_customer_code}</span></div>
            <form className="row" style={{ padding: 12 }} onSubmit={(e) => { e.preventDefault(); setSkuQ(sku.trim()); }}>
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ว่าง = เฉพาะสินค้าที่มีราคาเฉพาะลูกค้า · หรือพิมพ์ SKU / ชื่อเพื่อดูสินค้าใดก็ได้" style={{ flex: 1 }} />
              <button className="btn ghost" type="submit">แสดง</button>
            </form>
            {prices.error && <div className="err" style={{ padding: '0 12px' }}>{prices.error}</div>}
            {prices.data && (prices.data.items.length ? (
              <table>
                <thead><tr><th>SKU</th><th>สินค้า</th><th>ราคาปกติ</th><th>เฉพาะบริษัท</th><th>สัญญาสาขา</th><th>พิเศษสาขา</th><th>ขั้นบันได</th><th>วันนี้ลูกค้าจ่าย</th></tr></thead>
                <tbody>{prices.data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.sku}</td><td>{p.name}</td><td>{baht(p.base)}</td>
                    <td>{rowsText(p.layers.privatePrice)}</td><td>{rowsText(p.layers.contract)}</td><td>{rowsText(p.layers.branchSpecial)}</td>
                    <td>{p.layers.qtyRules.map((r: JoshRow) => `${r.min_qty}${r.max_qty ? `–${r.max_qty}` : '+'}: ${baht(r.promotion_price)}`).join(', ') || (p.layers.hasActiveMechanic ? 'มีโปรโมชัน' : '—')}</td>
                    <td><strong>{p.winner.price == null ? 'คำนวณที่ josh' : baht(p.winner.price)}</strong><div className="hint">{SOURCE[p.winner.source] ?? p.winner.source}</div></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className="empty">ไม่มีราคาเฉพาะลูกค้าสำหรับสาขานี้ — พิมพ์ SKU เพื่อดูสินค้าอื่น</div>)}
            {prices.data && <div className="hint" style={{ padding: '8px 16px' }}>{prices.data.note}</div>}
          </section>
          <section className="panel">
            <div className="panel-head">Quotation จาก ERP ({branch.erp_customer_code ?? 'ไม่มีรหัสลูกค้า'})</div>
            {quotes.data?.length ? (
              <table>
                <thead><tr><th>สินค้า</th><th>ราคา</th><th>หน่วย</th><th>ใช้ได้</th><th>สถานะ</th><th>เอกสาร</th></tr></thead>
                <tbody>{quotes.data.map((q, i) => (
                  <tr key={i}><td>{q.name}<div className="hint mono">{q.product_code}</div></td><td>{baht(q.rate)}</td><td>{q.unit}</td>
                    <td>{q.start_date ?? '…'} – {q.expiry_date ?? '…'}</td><td><span className={`badge ${q.status === 'Y' ? 'ok' : 'muted'}`}>{q.status === 'Y' ? 'ใช้งาน' : q.status === 'Z' ? 'ยกเลิก' : q.status}</span></td>
                    <td className="mono">{q.doc_book}{q.doc_no}</td></tr>
                ))}</tbody>
              </table>
            ) : <div className="empty">ไม่มี quotation</div>}
          </section>
        </>
      )}
    </div>
  );
}
