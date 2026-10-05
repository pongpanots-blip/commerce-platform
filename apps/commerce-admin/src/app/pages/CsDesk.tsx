import { FormEvent, useState } from 'react';
import { joshAdmin, joshCustomerApi, joshProductApi, JoshRow } from '../../lib/api';
import { useAsync } from '../hooks';

type Row = Record<string, unknown>;
/** josh answers lists as an array, `{ data }`, `{ data: { items } }` or `{ items }`. */
function rowsOf(answer: unknown): Row[] {
  const a = answer as { data?: unknown; items?: unknown } | unknown[] | null;
  if (Array.isArray(a)) return a as Row[];
  const d = a?.data as { items?: unknown; data?: unknown } | unknown[] | undefined;
  if (Array.isArray(d)) return d as Row[];
  if (Array.isArray(d?.items)) return d.items as Row[];
  if (Array.isArray(d?.data)) return d.data as Row[];
  if (Array.isArray(a?.items)) return a.items as Row[];
  return [];
}

const PAYMENT = [['credit', 'เครดิตเทอม'], ['qr', 'QR'], ['cod', 'เก็บปลายทาง'], ['payment_link', 'ลิงก์ชำระเงิน'], ['customer_credit', 'เครดิตลูกค้า']];
const SAMPLE_STATUS: Record<string, string> = { pending: 'รอพิจารณา', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', fulfilled: 'ส่งแล้ว' };
const baht = (n: unknown) => (n == null ? '—' : '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }));
const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * CS work that used to be in josh admin: order on behalf of a customer (josh quotes and places it
 * with its own checkout), sample requests, merging duplicate accounts. Everything runs as josh's own
 * CS-admin routes (josh COMMERCE_OWNS_CS_ORDERS / COMMERCE_OWNS_CUSTOMERS lock josh's own buttons).
 */
export function CsDesk() {
  const [tab, setTab] = useState<'order' | 'samples' | 'merge'>('order');
  return (
    <div>
      <div className="page-head"><div><h1>งาน CS <span className="hint">(josh)</span></h1>
        <p>สั่งของแทนลูกค้า · คำขอสินค้าตัวอย่าง · รวมบัญชีซ้ำ — josh ทำจริงในชื่อบัญชี josh ที่อีเมลตรงกับคุณ</p></div></div>
      <div className="row" role="tablist" style={{ marginBottom: 12, gap: 6 }}>
        {([['order', 'สั่งของแทนลูกค้า'], ['samples', 'คำขอสินค้าตัวอย่าง'], ['merge', 'รวมบัญชี']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn sm ${tab === k ? '' : 'ghost'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'order' ? <OrderOnBehalf /> : tab === 'samples' ? <Samples /> : <Merge />}
    </div>
  );
}

/** Company → one of its users and branches (from josh's replica). */
function CustomerPick({ onPick }: { onPick: (p: { company: JoshRow; userId: string; branchId: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const found = useAsync(() => (search ? joshCustomerApi.list({ search, page: 1, limit: 20 }) : Promise.resolve(null)), [search]);
  const detail = useAsync(() => (companyId ? joshCustomerApi.detail(companyId) : Promise.resolve(null)), [companyId]);
  const d = detail.data;
  const pick = (u: string, b: string) => { setUserId(u); setBranchId(b); onPick(d && u && b ? { company: d, userId: u, branchId: b } : null); };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <input aria-label="ค้นหาบริษัท" placeholder="ชื่อบริษัท / รหัสลูกค้า ERP" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn ghost sm">ค้นหา</button>
      </form>
      {found.data && (
        <label className="field">บริษัท
          <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); pick('', ''); }}>
            <option value="">— เลือก —</option>
            {found.data.items.map((c) => <option key={c.id} value={c.id}>{c.name} {c.erp_customer_code ? `(${c.erp_customer_code})` : ''}</option>)}
          </select></label>
      )}
      {d && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="field">ผู้ใช้<select value={userId} onChange={(e) => pick(e.target.value, branchId)}>
            <option value="">— เลือก —</option>{d.users.filter((u: JoshRow) => u.is_active).map((u: JoshRow) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ''} · {u.role}</option>)}</select></label>
          <label className="field">สาขาที่ส่ง<select value={branchId} onChange={(e) => pick(userId, e.target.value)}>
            <option value="">— เลือก —</option>{d.branches.map((b: JoshRow) => <option key={b.id} value={b.id}>{b.name}{b.is_default_delivery ? ' (หลัก)' : ''}</option>)}</select></label>
          <span className="hint">วงเงิน {baht(d.credit_limit)} · ใช้ไป {baht(d.credit_used)} · เครดิต {show(d.credit_term_days)} วัน</span>
        </div>
      )}
    </div>
  );
}

function OrderOnBehalf() {
  const [who, setWho] = useState<{ company: JoshRow; userId: string; branchId: string } | null>(null);
  const [items, setItems] = useState<{ id: string; sku: string; name: string; quantity: number }[]>([]);
  const [skuQ, setSkuQ] = useState('');
  const [skuSearch, setSkuSearch] = useState('');
  const [quote, setQuote] = useState<unknown>(null);
  const [pay, setPay] = useState({ payment_method: 'credit', coupon_code: '', delivery_date: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const products = useAsync(() => (skuSearch ? joshProductApi.list({ search: skuSearch, status: 'active', page: 1, limit: 10 }) : Promise.resolve(null)), [skuSearch]);
  const body = () => ({ user_id: who!.userId, branch_id: who!.branchId, items: items.map((i) => ({ product_inventory_id: i.id, quantity: i.quantity })) });

  async function run(fn: () => Promise<unknown>, after: (r: unknown) => void) {
    setBusy(true); setMsg('');
    try { after(await fn()); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const getQuote = () => run(() => joshAdmin.call('POST', '/cs-admin/orders/quote', body()), (r) => setQuote(r));
  function place(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm(`สั่ง ${items.length} รายการให้ ${who!.company.name} (${pay.payment_method})?\n\njosh จะสร้าง order จริงและส่งเข้า ERP ตามปกติ`)) return;
    run(() => joshAdmin.call('POST', '/cs-admin/orders/place-on-behalf', { ...body(), payment_method: pay.payment_method,
      ...(pay.coupon_code.trim() ? { coupon_code: pay.coupon_code.trim() } : {}), ...(pay.delivery_date ? { delivery_date: pay.delivery_date } : {}) }),
    (r) => { setMsg(`สร้าง order แล้ว: ${JSON.stringify((r as { data?: unknown })?.data ?? r).slice(0, 200)}`); setItems([]); setQuote(null); });
  }
  return (
    <section className="panel" style={{ display: 'grid', gap: 12, padding: 12 }}>
      <CustomerPick onPick={(p) => { setWho(p); setQuote(null); }} />
      {who && <>
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); setSkuSearch(skuQ.trim()); }}>
          <input aria-label="ค้นหาสินค้า" placeholder="SKU / ชื่อสินค้า" value={skuQ} onChange={(e) => setSkuQ(e.target.value)} />
          <button className="btn ghost sm">ค้นหาสินค้า</button>
        </form>
        {products.data?.items.map((p) => (
          <div key={p.product_inventory_id} className="row" style={{ gap: 8 }}>
            <span className="mono">{p.product_inventory_sku}</span><span>{p.name_th ?? p.name_en}</span><span className="hint">{baht(p.selling_unit_price)} / {p.selling_unit ?? '—'}</span>
            <button className="btn ghost sm" onClick={() => { setItems([...items.filter((i) => i.id !== p.product_inventory_id), { id: p.product_inventory_id, sku: p.product_inventory_sku, name: p.name_th ?? '', quantity: 1 }]); setQuote(null); }}>เพิ่ม</button>
          </div>
        ))}
        {!!items.length && (
          <table><thead><tr><th>SKU</th><th>สินค้า</th><th>จำนวน</th><th></th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}><td className="mono">{i.sku}</td><td>{i.name}</td>
                <td><input aria-label={`จำนวน ${i.sku}`} type="number" min={1} style={{ width: 80 }} value={i.quantity}
                  onChange={(e) => { setItems(items.map((x) => (x.id === i.id ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))); setQuote(null); }} /></td>
                <td><button className="btn ghost sm" onClick={() => { setItems(items.filter((x) => x.id !== i.id)); setQuote(null); }}>เอาออก</button></td></tr>
            ))}</tbody></table>
        )}
        <div className="row"><button className="btn sm" disabled={busy || !items.length} onClick={getQuote}>คิดราคา (josh)</button></div>
        {quote != null && <>
          <pre className="payload">{JSON.stringify(quote, null, 2).slice(0, 4000)}</pre>
          <form onSubmit={place} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field">ชำระด้วย<select value={pay.payment_method} onChange={(e) => setPay({ ...pay, payment_method: e.target.value })}>
              {PAYMENT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field">คูปอง<input value={pay.coupon_code} onChange={(e) => setPay({ ...pay, coupon_code: e.target.value })} /></label>
            <label className="field">วันส่ง (ว่าง = ตามรอบ)<input type="date" value={pay.delivery_date} onChange={(e) => setPay({ ...pay, delivery_date: e.target.value })} /></label>
            <button className="btn sm" disabled={busy}>สั่งซื้อ</button>
          </form>
        </>}
      </>}
      {msg && <div className="hint" role="status">{msg}</div>}
    </section>
  );
}

function Samples() {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const list = useAsync(() => joshAdmin.get('/cs-admin/sample-requests', status ? { status } : undefined), [status]);
  async function decide(id: string, next: string) {
    const note = window.prompt(`${SAMPLE_STATUS[next]} — หมายเหตุ CS (ไม่บังคับ)`, '');
    if (note === null) return;
    setBusy(true); setMsg('');
    try { await joshAdmin.call('PATCH', `/cs-admin/sample-requests/${id}`, { status: next, ...(note ? { cs_note: note } : {}) }); setMsg(`${SAMPLE_STATUS[next]}แล้ว`); list.reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const rows = rowsOf(list.data);
  return (
    <section className="panel" style={{ padding: 12 }}>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        {[['', 'ทั้งหมด'], ...Object.entries(SAMPLE_STATUS)].map(([k, l]) => <button key={k} className={`btn sm ${status === k ? '' : 'ghost'}`} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      {msg && <div className="hint" role="status">{msg}</div>}
      {list.error && <div className="err">{list.error}</div>}
      {rows.length ? (
        <table><thead><tr><th>ขอเมื่อ</th><th>ลูกค้า</th><th>สินค้า</th><th>จำนวน</th><th>สถานะ</th><th>หมายเหตุ</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={String(r.id)}>
              <td>{r.created_at ? new Date(String(r.created_at)).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
              <td>{show((r.company as JoshRow)?.name ?? r.company_name ?? r.user_id)}</td>
              <td>{show((r.product as JoshRow)?.product_inventory_sku ?? r.sku ?? r.product_inventory_id)}</td>
              <td>{show(r.quantity)}</td><td>{SAMPLE_STATUS[String(r.status)] ?? show(r.status)}</td><td>{show(r.cs_note)}</td>
              <td className="row" style={{ gap: 4 }}>
                {r.status === 'pending' && <><button className="btn sm" disabled={busy} onClick={() => decide(String(r.id), 'approved')}>อนุมัติ</button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => decide(String(r.id), 'rejected')}>ไม่อนุมัติ</button></>}
                {r.status === 'approved' && <button className="btn ghost sm" disabled={busy} onClick={() => decide(String(r.id), 'fulfilled')}>ส่งแล้ว</button>}
              </td>
            </tr>
          ))}</tbody></table>
      ) : <div className="empty">{list.data ? 'ไม่มีคำขอ' : 'Loading…'}</div>}
    </section>
  );
}

function Merge() {
  const [v, setV] = useState({ primary_user_id: '', duplicate_user_id: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const uuid = /^[0-9a-f-]{36}$/i;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!uuid.test(v.primary_user_id) || !uuid.test(v.duplicate_user_id) || v.primary_user_id === v.duplicate_user_id) return setMsg('ใส่ user id (uuid) สองบัญชีที่ต่างกัน');
    if (!window.confirm(`รวมบัญชี ${v.duplicate_user_id} เข้า ${v.primary_user_id}?\n\nบัญชีซ้ำจะถูกย้ายข้อมูลเข้าบัญชีหลัก ย้อนกลับไม่ได้`)) return;
    setBusy(true); setMsg('');
    try { const r = await joshAdmin.call('POST', '/cs-admin/accounts/merge', v); setMsg(`รวมแล้ว: ${JSON.stringify(r).slice(0, 200)}`); setV({ primary_user_id: '', duplicate_user_id: '' }); }
    catch (err) { setMsg(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="panel" style={{ display: 'grid', gap: 8, padding: 12, maxWidth: 520 }}>
      <div className="hint">หา user id ได้จาก รายงานร้าน › ลูกค้า (รายละเอียด) · ต้องเป็น admin</div>
      <label className="field">บัญชีหลัก (เก็บไว้)<input className="mono" value={v.primary_user_id} onChange={(e) => setV({ ...v, primary_user_id: e.target.value.trim() })} /></label>
      <label className="field">บัญชีซ้ำ (รวมเข้า)<input className="mono" value={v.duplicate_user_id} onChange={(e) => setV({ ...v, duplicate_user_id: e.target.value.trim() })} /></label>
      {msg && <div className="hint" role="status">{msg}</div>}
      <div className="row"><button className="btn sm danger" disabled={busy}>รวมบัญชี</button></div>
    </form>
  );
}
