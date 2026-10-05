import { useState } from 'react';
import { joshActionsApi } from '../../lib/api';

/** josh ASSIGNABLE_ADMIN_ROLES (admin-access.constants.ts). */
const ADMIN_ROLES = ['cs', 'marketing', 'merchandising', 'sale', 'sales', 'manager', 'admin', 'dev', 'platform_admin'];
const CREDIT_OPEN = ['PENDING', 'REVIEW', 'REQUEST_DOC'];
type Row = Record<string, unknown>;

/** Lists that have a button which asks josh to act. */
export const ACTION_VIEWS = new Set(['credit_terms', 'admin_access', 'coupons']);

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
