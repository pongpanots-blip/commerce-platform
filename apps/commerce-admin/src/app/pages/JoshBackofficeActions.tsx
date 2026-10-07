import { FormEvent, useState } from 'react';
import { Button, Field, FormPanel, Input, Select, Textarea } from '@cp/ui';
import { JOSH_STAFF_ROLES, joshActionsApi } from '../../lib/api';

/** josh ASSIGNABLE_ADMIN_ROLES (admin-access.constants.ts) — approving a request may still give platform_admin (josh's rule). */
const ADMIN_ROLES = [...JOSH_STAFF_ROLES, 'platform_admin'];
const CREDIT_OPEN = ['PENDING', 'REVIEW', 'REQUEST_DOC'];
type Row = Record<string, unknown>;

/** Lists that have a button which asks josh to act. */
export const ACTION_VIEWS = new Set(['credit_terms', 'admin_access', 'coupons', 'suppliers', 'internal_docs']);
const SUPPLIER_FIELDS: [string, string][] = [['supplier_name', 'ชื่อ'], ['contact_name', 'ผู้ติดต่อ'], ['phone', 'โทร'], ['email', 'อีเมล'], ['address', 'ที่อยู่']];
const DOC_CATEGORIES = ['backend', 'webshop', 'landing', 'api', 'mobileapp'];
const DOC_MAX_BYTES = 90_000;
const confirmJosh = (text: string) => window.confirm(`${text}\n\nคำสั่งนี้จะให้ josh ทำจริง (ในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit)`);

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
    if (!window.confirm(`${confirmText}\n\nคำสั่งนี้จะให้ josh ทำจริง (ในนามของคุณ — josh บันทึกอีเมลคุณไว้ใน audit)`)) return;
    setBusy(true); setErr('');
    try { await fn(); setOpen(false); setForm({}); onDone(done); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (view === 'suppliers') return <SupplierAction row={row} onDone={onDone} />;

  if (view === 'internal_docs') {
    return (
      <Button
        size="sm"
        variant="danger-ghost"
        disabled={busy}
        onClick={() => run(`ลบเอกสาร "${row.title}"?`, () => joshActionsApi.removeDoc(String(row.id)), `ลบ "${row.title}" แล้ว`)}
      >
        ลบ
      </Button>
    );
  }

  if (view === 'coupons') {
    const active = !!row.is_active;
    return (
      <Button
        size="sm"
        variant={active ? 'ghost' : 'primary'}
        disabled={busy}
        onClick={() => run(`${active ? 'ปิด' : 'เปิด'}คูปอง ${row.coupon_code}?`, () => joshActionsApi.setCouponActive(String(row.id), !active), `${active ? 'ปิด' : 'เปิด'}คูปอง ${row.coupon_code} แล้ว`)}
      >
        {active ? 'ปิดคูปอง' : 'เปิดคูปอง'}
      </Button>
    );
  }

  const pending = view === 'admin_access' ? row.status === 'pending' : CREDIT_OPEN.includes(String(row.status));
  if (!pending) return null;

  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>พิจารณา</Button>;

  if (view === 'admin_access') {
    return (
      <FormPanel
        title="กำหนดสิทธิ์"
        icon="security"
        cols={1}
        error={err}
        busy={busy}
        onSubmit={() => run(`อนุมัติ ${row.email} เป็น ${form.role}?`, () => joshActionsApi.approveAccess(String(row.id), form.role), `อนุมัติ ${row.email} แล้ว`)}
        onCancel={() => setOpen(false)}
        submitLabel="อนุมัติ"
        extraActions={
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => run(`ไม่อนุมัติ ${row.email}?`, () => joshActionsApi.rejectAccess(String(row.id), form.reason ?? ''), `ไม่อนุมัติ ${row.email} แล้ว`)}
          >
            ไม่อนุมัติ
          </Button>
        }
      >
        <Field label="ให้สิทธิ์">
          <Select value={form.role ?? ''} onChange={(e) => set('role', e.target.value)}>
            <option value="">— เลือก role —</option>
            {ADMIN_ROLES.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="เหตุผลที่ไม่อนุมัติ">
          <Input value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} />
        </Field>
      </FormPanel>
    );
  }

  return (
    <FormPanel
      title="ตรวจสอบวงเงิน"
      icon="request_quote"
      cols={2}
      error={err}
      busy={busy}
      onSubmit={() => run(
        `${row.company_name}: ${form.status}${form.status === 'APPROVED' ? ` วงเงิน ${form.limit || row.requested_credit_limit} / ${form.days || row.requested_term_days} วัน (จะตั้งวงเงินของบริษัทใน josh ทันที)` : ''}?`,
        () => joshActionsApi.reviewCredit(String(row.application_id), {
          status: form.status,
          ...(form.limit ? { approved_credit_limit: Number(form.limit) } : {}), ...(form.days ? { approved_term_days: Number(form.days) } : {}),
          ...(form.reason ? { reject_reason: form.reason } : {}), ...(form.remark ? { accounting_remark: form.remark } : {}),
        }),
        `บันทึกผลของ ${row.company_name} แล้ว`)}>
      <Field label="ผล">
        <Select value={form.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">— เลือก —</option>
          <option value="APPROVED">อนุมัติ</option>
          <option value="REJECTED">ไม่อนุมัติ</option>
          <option value="REQUEST_DOC">ขอเอกสารเพิ่ม</option>
          <option value="REVIEW">กำลังตรวจ</option>
        </Select>
      </Field>
      {form.status === 'APPROVED' && (
        <>
          <Field label="วงเงินที่อนุมัติ" hint={`ว่าง = ตามที่ขอ ${String(row.requested_credit_limit ?? '')}`}>
            <Input type="number" min="0" value={form.limit ?? ''} onChange={(e) => set('limit', e.target.value)} />
          </Field>
          <Field label="เครดิต (วัน)" hint={`ว่าง = ตามที่ขอ ${String(row.requested_term_days ?? '')}`}>
            <Input type="number" min="0" value={form.days ?? ''} onChange={(e) => set('days', e.target.value)} />
          </Field>
        </>
      )}
      {form.status === 'REJECTED' && (
        <Field label="เหตุผล">
          <Input value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} />
        </Field>
      )}
      <Field label="หมายเหตุบัญชี">
        <Input value={form.remark ?? ''} onChange={(e) => set('remark', e.target.value)} />
      </Field>
    </FormPanel>
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
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setForm({ supplier_name: String(row.supplier_name ?? ''), contact_name: '', phone: '', email: '', address: String(row.address ?? '') })}>แก้</Button>
        <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => go(`ลบ supplier "${row.supplier_name}"?`, () => joshActionsApi.removeSupplier(id), `ลบ ${row.supplier_name} แล้ว`)}>ลบ</Button>
      </div>
    );
  }

  const changes = () => Object.fromEntries(Object.entries(form).filter(([k, v]) => k === 'supplier_name' || v.trim() !== '').map(([k, v]) => [k, v.trim()]));

  return (
    <FormPanel
      title={`แก้ supplier`}
      icon="edit"
      cols={1}
      error={err}
      busy={busy}
      onSubmit={() => go(`บันทึก supplier "${form.supplier_name}"?`, () => joshActionsApi.updateSupplier(id, changes()), `บันทึก ${form.supplier_name} แล้ว`)}
      onCancel={() => setForm(null)}
    >
      <SupplierFields form={form} setForm={setForm} masked />
    </FormPanel>
  );
}

function SupplierFields({ form, setForm, masked }: { form: Record<string, string>; setForm: (f: Record<string, string>) => void; masked?: boolean }) {
  return (
    <>
      {SUPPLIER_FIELDS.map(([k, label]) => (
        <Field key={k} label={label} hint={masked && k !== 'supplier_name' && k !== 'address' ? ' (ว่าง = คงเดิม)' : undefined}>
          <Input
            type={k === 'email' ? 'email' : 'text'}
            value={form[k] ?? ''}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          />
        </Field>
      ))}
    </>
  );
}

/** The "add" form above a list that has one: new supplier, or upload a markdown doc. */
export function ViewCreate({ view, onDone }: { view: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ category: DOC_CATEGORIES[0] });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (view !== 'suppliers' && view !== 'internal_docs') return null;

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        {view === 'suppliers' ? 'เพิ่ม supplier' : 'อัปโหลดเอกสาร (.md)'}
      </Button>
    );
  }

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
    <FormPanel
      title={view === 'suppliers' ? 'เพิ่ม supplier' : 'อัปโหลดเอกสาร'}
      icon={view === 'suppliers' ? 'add_circle' : 'upload_file'}
      cols={1}
      error={err}
      busy={busy}
      onSubmit={submit}
      onCancel={() => setOpen(false)}
    >
      {view === 'suppliers' ? (
        <SupplierFields form={form} setForm={setForm} />
      ) : (
        <>
          <Field label="หมวด">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="ชื่อ" hint="ว่าง = จากชื่อไฟล์">
            <Input value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="ไฟล์ .md">
            <Input type="file" accept=".md,text/markdown" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </>
      )}
    </FormPanel>
  );
}
