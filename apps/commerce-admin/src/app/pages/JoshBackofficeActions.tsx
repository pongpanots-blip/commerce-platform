import { FormEvent, useState } from 'react';
import { joshActionsApi } from '../../lib/api';

/** josh ASSIGNABLE_ADMIN_ROLES (admin-access.constants.ts). */
const ADMIN_ROLES = ['cs', 'marketing', 'merchandising', 'sale', 'sales', 'manager', 'admin', 'dev', 'platform_admin'];
const CREDIT_OPEN = ['PENDING', 'REVIEW', 'REQUEST_DOC'];
type Row = Record<string, unknown>;

/** Lists that have a button which asks josh to act. */
export const ACTION_VIEWS = new Set(['credit_terms', 'admin_access', 'coupons', 'suppliers', 'internal_docs']);
const SUPPLIER_FIELDS: [string, string][] = [['supplier_name', 'ชื่อ'], ['contact_name', 'ผู้ติดต่อ'], ['phone', 'โทร'], ['email', 'อีเมล'], ['address', 'ที่อยู่']];
const DOC_CATEGORIES = ['backend', 'webshop', 'landing', 'api', 'mobileapp'];
/** commerce's JSON body limit is 100 kB; josh's own 2 MB limit is not reachable from here. */
const DOC_MAX_BYTES = 90_000;
const confirmJosh = (text: string) => window.confirm(`${text}\n\nคำสั่งนี้จะให้ josh ทำจริง (ในชื่อบัญชี josh ที่อีเมลตรงกับคุณ)`);

/**
 * The one button per row that asks josh to act, with a confirm step. josh decides with its own rules
 * (platform_admin for admin access) and answers in Thai; that answer is shown as is.
 */
export function RowAction({ view, row, onDone }: { view: string; row: Row; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  async function run(confirmText: string, fn: () => Promise<unknown>, done: string) {
    if (!window.confirm(`${confirmText}\n\nคำสั่งนี้จะให้ josh ทำจริง (ในชื่อบัญชี josh ที่อีเมลตรงกับคุณ)`)) return;
    setBusy(true); setErr('');
    try { await fn(); setOpen(false); setForm({}); onDone(done); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (view === 'suppliers') return <SupplierAction row={row} onDone={onDone} />;
  if (view === 'internal_docs') {
    return (
      <span>
        <button className="btn ghost sm danger" disabled={busy}
          onClick={() => run(`ลบเอกสาร "${row.title}"?`, () => joshActionsApi.removeDoc(String(row.id)), `ลบ "${row.title}" แล้ว`)}>ลบ</button>
        {err && <div className="err">{err}</div>}
      </span>
    );
  }

  if (view === 'coupons') {
    const active = !!row.is_active;
    return (
      <span>
        <button className={`btn sm ${active ? 'ghost' : ''}`} disabled={busy}
          onClick={() => run(`${active ? 'ปิด' : 'เปิด'}คูปอง ${row.coupon_code}?`, () => joshActionsApi.setCouponActive(String(row.id), !active), `${active ? 'ปิด' : 'เปิด'}คูปอง ${row.coupon_code} แล้ว`)}>
          {active ? 'ปิดคูปอง' : 'เปิดคูปอง'}
        </button>
        {err && <div className="err">{err}</div>}
      </span>
    );
  }

  const pending = view === 'admin_access' ? row.status === 'pending' : CREDIT_OPEN.includes(String(row.status));
  if (!pending) return null;
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>พิจารณา</button>;

  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
      {view === 'admin_access' ? (
        <>
          <label className="field">ให้สิทธิ์<select value={form.role ?? ''} onChange={(e) => set('role', e.target.value)}>
            <option value="">— เลือก role —</option>{ADMIN_ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
          <div className="row">
            <button className="btn sm" disabled={busy || !form.role} onClick={() => run(`อนุมัติ ${row.email} เป็น ${form.role}?`, () => joshActionsApi.approveAccess(String(row.id), form.role), `อนุมัติ ${row.email} แล้ว`)}>อนุมัติ</button>
          </div>
          <label className="field">เหตุผลที่ไม่อนุมัติ<input value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} /></label>
          <div className="row">
            <button className="btn sm danger" disabled={busy} onClick={() => run(`ไม่อนุมัติ ${row.email}?`, () => joshActionsApi.rejectAccess(String(row.id), form.reason ?? ''), `ไม่อนุมัติ ${row.email} แล้ว`)}>ไม่อนุมัติ</button>
            <button className="btn ghost sm" onClick={() => setOpen(false)}>ยกเลิก</button>
          </div>
        </>
      ) : (
        <>
          <label className="field">ผล<select value={form.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">— เลือก —</option><option value="APPROVED">อนุมัติ</option><option value="REJECTED">ไม่อนุมัติ</option>
            <option value="REQUEST_DOC">ขอเอกสารเพิ่ม</option><option value="REVIEW">กำลังตรวจ</option></select></label>
          {form.status === 'APPROVED' && <>
            <label className="field">วงเงินที่อนุมัติ (ว่าง = ตามที่ขอ {String(row.requested_credit_limit ?? '')})<input type="number" min={0} value={form.limit ?? ''} onChange={(e) => set('limit', e.target.value)} /></label>
            <label className="field">เครดิต (วัน) (ว่าง = ตามที่ขอ {String(row.requested_term_days ?? '')})<input type="number" min={0} value={form.days ?? ''} onChange={(e) => set('days', e.target.value)} /></label>
          </>}
          {form.status === 'REJECTED' && <label className="field">เหตุผล<input value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} /></label>}
          <label className="field">หมายเหตุบัญชี<input value={form.remark ?? ''} onChange={(e) => set('remark', e.target.value)} /></label>
          <div className="row">
            <button className="btn sm" disabled={busy || !form.status} onClick={() => run(
              `${row.company_name}: ${form.status}${form.status === 'APPROVED' ? ` วงเงิน ${form.limit || row.requested_credit_limit} / ${form.days || row.requested_term_days} วัน (จะตั้งวงเงินของบริษัทใน josh ทันที)` : ''}?`,
              () => joshActionsApi.reviewCredit(String(row.application_id), {
                status: form.status,
                ...(form.limit ? { approved_credit_limit: Number(form.limit) } : {}), ...(form.days ? { approved_term_days: Number(form.days) } : {}),
                ...(form.reason ? { reject_reason: form.reason } : {}), ...(form.remark ? { accounting_remark: form.remark } : {}),
              }),
              `บันทึกผลของ ${row.company_name} แล้ว`)}>บันทึก</button>
            <button className="btn ghost sm" onClick={() => setOpen(false)}>ยกเลิก</button>
          </div>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}

/** Edit / delete one supplier. Phone and email show masked here — fill them only to change them. */
function SupplierAction({ row, onDone }: { row: Row; onDone: (msg: string) => void }) {
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = String(row.supplier_id);
  async function go(text: string, fn: () => Promise<unknown>, done: string) {
    if (!confirmJosh(text)) return;
    setBusy(true); setErr('');
    try { await fn(); setForm(null); onDone(done); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  if (!form) {
    return (
      <span className="row" style={{ gap: 4 }}>
        <button className="btn ghost sm" onClick={() => setForm({ supplier_name: String(row.supplier_name ?? ''), contact_name: '', phone: '', email: '', address: String(row.address ?? '') })}>แก้</button>
        <button className="btn ghost sm danger" disabled={busy} onClick={() => go(`ลบ supplier "${row.supplier_name}"?`, () => joshActionsApi.removeSupplier(id), `ลบ ${row.supplier_name} แล้ว`)}>ลบ</button>
        {err && <div className="err">{err}</div>}
      </span>
    );
  }
  const changes = () => Object.fromEntries(Object.entries(form).filter(([k, v]) => k === 'supplier_name' || v.trim() !== '').map(([k, v]) => [k, v.trim()]));
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 240 }}>
      <SupplierFields form={form} setForm={setForm} masked />
      <div className="row">
        <button className="btn sm" disabled={busy || !form.supplier_name.trim()} onClick={() => go(`บันทึก supplier "${form.supplier_name}"?`, () => joshActionsApi.updateSupplier(id, changes()), `บันทึก ${form.supplier_name} แล้ว`)}>บันทึก</button>
        <button className="btn ghost sm" onClick={() => setForm(null)}>ยกเลิก</button>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

function SupplierFields({ form, setForm, masked }: { form: Record<string, string>; setForm: (f: Record<string, string>) => void; masked?: boolean }) {
  return <>{SUPPLIER_FIELDS.map(([k, label]) => (
    <label key={k} className="field">{label}{masked && k !== 'supplier_name' && k !== 'address' ? ' (ว่าง = คงเดิม)' : ''}
      <input type={k === 'email' ? 'email' : 'text'} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
  ))}</>;
}

/** The "add" form above a list that has one: new supplier, or upload a markdown doc. */
export function ViewCreate({ view, onDone }: { view: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ category: DOC_CATEGORIES[0] });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (view !== 'suppliers' && view !== 'internal_docs') return null;
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>{view === 'suppliers' ? 'เพิ่ม supplier' : 'อัปโหลดเอกสาร (.md)'}</button>;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    let fn: () => Promise<unknown>;
    let done: string;
    if (view === 'suppliers') {
      if (!form.supplier_name?.trim()) return setErr('ต้องมีชื่อ supplier');
      const supplier = Object.fromEntries(SUPPLIER_FIELDS.map(([k]) => [k, (form[k] ?? '').trim()]).filter(([, v]) => v));
      fn = () => joshActionsApi.createSupplier(supplier);
      done = `เพิ่ม ${form.supplier_name} แล้ว`;
    } else {
      if (!file || !file.name.toLowerCase().endsWith('.md')) return setErr('เลือกไฟล์ .md');
      if (file.size > DOC_MAX_BYTES) return setErr(`ไฟล์ใหญ่เกิน ${DOC_MAX_BYTES / 1000} KB`);
      const content = await file.text();
      fn = () => joshActionsApi.uploadDoc({ category: form.category, title: form.title?.trim() || undefined, filename: file.name, content });
      done = `อัปโหลด ${file.name} แล้ว`;
    }
    if (!confirmJosh(view === 'suppliers' ? `เพิ่ม supplier "${form.supplier_name}"?` : `อัปโหลด ${file!.name} (${form.category})?`)) return;
    setBusy(true);
    try { await fn(); setOpen(false); setForm({ category: DOC_CATEGORIES[0] }); setFile(null); onDone(done); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="panel" style={{ display: 'grid', gap: 8, padding: 12, maxWidth: 480 }}>
      {view === 'suppliers' ? <SupplierFields form={form} setForm={setForm} /> : <>
        <label className="field">หมวด<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">ชื่อ (ว่าง = จากชื่อไฟล์)<input value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="field">ไฟล์ .md<input type="file" accept=".md,text/markdown" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </>}
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="btn sm" disabled={busy}>{busy ? 'กำลังส่ง…' : 'บันทึก'}</button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>ยกเลิก</button></div>
    </form>
  );
}
