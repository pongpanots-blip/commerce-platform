// ui-metadata-migration: static labels and UI notices only
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert, Button, Chip, CopyValue, Empty, ErrorText, Hint, TaskPanelForm, TaskInput, TaskSelect, useUnsavedChanges, Loading, Modal, Page, PageHeader, Panel, PanelHead, Select,
  StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { session, staffApi, STAFF_ROLE_LABEL, StaffAccount, StaffRole } from '../../lib/api';
import { useAsync } from '../hooks';
import { InterruptedAction, requireSaved, taskMessages, useActionDraft, writeFailure } from '../task-forms';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ROLES = Object.keys(STAFF_ROLE_LABEL) as StaffRole[];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * commerce-admin › บัญชี staff (admin only). Accounts are commerce's own — no josh account needed.
 * A new account or a reset shows a temporary password once; it is not stored anywhere readable.
 */
export function StaffAccounts() {
  __useUiLocale();
  const me = session.claims()?.sub;
  const list = useAsync(() => staffApi.list(), []);
  const location = useLocation();
  const navigate = useNavigate();
  const creating = location.pathname === '/settings/staff/new';
  const draft = useActionDraft('staff:create', { email: '', name: '', role: 'marketing' });
  const form = draft.values;
  const leave = () => navigate(`/settings/staff${location.search}${location.hash}`);
  useUnsavedChanges(creating && (draft.dirty || draft.pending));
  const close = () => { if (!draft.pending) leave(); };
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handOver, setHandOver] = useState<{ email: string; password: string; what: string } | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, after?: (r: T) => void) {
    if (lock.current || !draft.lock()) return;
    lock.current = true;
    setBusy(key); setHandOver(null); setError(null);
    try {
      const r = await fn();
      if (mounted.current) { after?.(r); list.reload(); }
    } catch (e) {
      if (mounted.current) setError(errorText(e));
    } finally {
      lock.current = false; draft.settle();
      if (mounted.current) setBusy(null);
    }
  }

  async function create(_data: FormData, signal: AbortSignal) {
    if (lock.current || !draft.begin(signal)) return { ok: false as const, formError: __uiText('ยังยืนยันผลการบันทึกไม่ได้') };
    lock.current = true; setHandOver(null);
    try {
      const result = requireSaved(await staffApi.create({ email: form.email.trim(), name: form.name.trim() || undefined, role: form.role as StaffRole }), r => !!r.account?.id && !!r.account.email && typeof r.temporaryPassword === 'string' && !!r.temporaryPassword);
      return { ok: true as const, receipt: result };
    } catch (error) { if (!signal.aborted) draft.fail(error); return writeFailure(error); }
    finally { lock.current = false; draft.settle(); }
  }
  function created(r: { account: StaffAccount; temporaryPassword: string }) {
    draft.clear(); setHandOver({ email: r.account.email, password: r.temporaryPassword, what: __uiText('สร้างบัญชีแล้ว') });
    leave(); list.reload();
  }
  async function checkLatest() {
    const rows = await staffApi.list();
    const found = rows.find(row => row.email.toLowerCase() === form.email.trim().toLowerCase());
    list.reload();
    return found ? __uiText('พบบัญชี {0} แล้ว หากไม่มีรหัสผ่านชั่วคราว ให้ปิดแบบฟอร์มและใช้รีเซ็ตรหัสผ่าน', { 0: found.email }) : __uiText('ไม่พบบัญชีที่ใช้อีเมลนี้ในรายการล่าสุด ตรวจอีเมลก่อนลองใหม่');
  }
  const reset = (a: StaffAccount) => window.confirm(__uiText("รีเซ็ตรหัสผ่านของ {0}?\n\nรหัสเดิมใช้ไม่ได้ทันที", {"0": a.email}))
    && run(`reset:${a.id}`, async () => requireSaved(await staffApi.resetPassword(a.id), r => typeof r.temporaryPassword === 'string' && !!r.temporaryPassword), (r) => setHandOver({ email: a.email, password: r.temporaryPassword, what: __uiText('รีเซ็ตรหัสผ่านแล้ว') }));
  const toggle = (a: StaffAccount) => window.confirm(__uiText(a.status === 'active' ? 'ปิดบัญชี {0}?\n\nออกจากระบบทันทีทุกเครื่อง' : 'เปิดบัญชี {0}?', { '0': a.email }))
    && run(`status:${a.id}`, async () => requireSaved(await staffApi.update(a.id, { status: a.status === 'active' ? 'disabled' : 'active' }), r => r.id === a.id && r.status === (a.status === 'active' ? 'disabled' : 'active')));
  const setRole = (a: StaffAccount, role: StaffRole) => role !== a.role && window.confirm(__uiText("เปลี่ยน {0} เป็น {1}?", {"0": a.email, "1": role}))
    && run(`role:${a.id}`, async () => requireSaved(await staffApi.update(a.id, { role }), r => r.id === a.id && r.role === role));

  useUnsavedChanges(!!busy || draft.outstanding);
  const rows = list.data ?? [];
  return (
    <Page>
      <PageHeader
        title={__uiText("บัญชีทีมงาน")}
        subtitle={__uiText("จัดการผู้ใช้แพลตฟอร์ม บทบาท และสิทธิ์การเข้าใช้งาน")}
        actions={
          <>
            <Button icon="refresh" onClick={list.reload}>{__uiText("รีเฟรช")}</Button>
            <Button variant="primary" icon="person_add" disabled={!!busy || draft.pending || draft.outstanding} onClick={() => { navigate(`/settings/staff/new${location.search}${location.hash}`); setError(null); }}>{__uiText("เพิ่มบัญชี")}</Button>
          </>
        }
      />

      {handOver && (
        <Alert tone="ok" title={`${handOver.what}: ${handOver.email}`} onClose={() => setHandOver(null)}>
          <div className="space-y-2">
            <div>{__uiText("รหัสผ่านชั่วคราว (แสดงครั้งเดียว — ส่งให้เจ้าของบัญชีทางช่องทางส่วนตัว แล้วให้เปลี่ยนที่เมนู \"เปลี่ยนรหัสผ่าน\"):")}</div>
            <CopyValue value={handOver.password} />
          </div>
        </Alert>
      )}
      <ErrorText error={error || list.error} onRetry={list.error ? list.reload : undefined} />

      {creating && (
        <Modal title={__uiText('เพิ่มบัญชีทีมงาน')} onClose={close} width={640}>
          {draft.recovered && !draft.interrupted && <Hint>{__uiText('กู้คืนข้อมูลที่ยังไม่บันทึกแล้ว ตรวจข้อมูลก่อนบันทึก')}</Hint>}
          {draft.interrupted && <InterruptedAction onCheck={checkLatest} onContinue={draft.acknowledge} outstanding={draft.outstanding} />}
          <TaskPanelForm title={__uiText('ข้อมูลบัญชีทีมงาน')} icon="person_add" messages={taskMessages()} disabled={draft.interrupted || draft.outstanding || !!busy} submitLabel={__uiText('สร้างบัญชี')} onSubmit={create} onSuccess={created} onCancel={leave}
            validate={() => ({ ...(!form.email.trim() ? { email: __uiText('กรอกอีเมล เช่น name@example.com') } : {}), ...(!ROLES.includes(form.role as StaffRole) ? { role: __uiText('เลือกสิทธิ์ที่รองรับ') } : {}) })}
            description={__uiText('ระบบสร้างรหัสผ่านชั่วคราวให้ แสดงครั้งเดียวหลังกดสร้าง')}>
            <TaskInput name="email" label={__uiText('อีเมล')} type="email" required autoFocus value={form.email} onChange={e => draft.set(current => ({ ...current, email: e.target.value }))} />
            <TaskInput name="name" label={__uiText('ชื่อ')} value={form.name} onChange={e => draft.set(current => ({ ...current, name: e.target.value }))} />
            <TaskSelect name="role" label={__uiText('สิทธิ์')} required value={form.role} onChange={e => draft.set(current => ({ ...current, role: e.target.value }))}>{ROLES.map(r => <option key={r} value={r}>{__uiText(STAFF_ROLE_LABEL[r])}</option>)}</TaskSelect>
          </TaskPanelForm>
        </Modal>
      )}

      <Panel className="overflow-hidden">
        <PanelHead icon="group" title={__uiText("บัญชีทั้งหมด")} sub={list.data && __uiText("{0} ใช้งาน · {1} ทั้งหมด",{'0':rows.filter((a) => a.status === 'active').length,'1':rows.length})} />
        {list.loading && !list.data ? (
          <Loading variant="table" />
        ) : list.error && !list.data ? null : rows.length ? (
          <Table scrollLabel={__uiText("รายการทั้งหมด")}>
            <THead>
              <TH>{__uiText("อีเมล")}</TH>
              <TH>{__uiText("ชื่อ")}</TH>
              <TH>{__uiText("สิทธิ์")}</TH>
              <TH>{__uiText("สถานะ")}</TH>
              <TH>{__uiText("สร้างเมื่อ")}</TH>
              <TH kind="actions">{__uiText("จัดการ")}</TH>
            </THead>
            <TBody>
              {rows.map((a) => {
                const self = a.id === me;
                return (
                  <TR key={a.id}>
                    <TD kind="mono">{a.email}{self && <Chip tone="info" className="ml-2">{__uiText("คุณ")}</Chip>}</TD>
                    <TD>{a.name ?? '—'}</TD>
                    <TD>
                      <Select aria-label={__uiText("สิทธิ์ของ {0}", {"0": a.email})} value={a.role} disabled={self || !!busy || draft.pending || draft.outstanding} onChange={(e) => setRole(a, e.target.value as StaffRole)}>
                        {!ROLES.includes(a.role) && <option value={a.role}>{a.role}</option>}
                        {ROLES.map((r) => <option key={r} value={r}>{__uiText(STAFF_ROLE_LABEL[r])}</option>)}
                      </Select>
                    </TD>
                    <TD><StatusChip status={a.status} /></TD>
                    <TD kind="time">{fmt.when(a.createdAt)}</TD>
                    <TD kind="actions">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" icon="key" disabled={!!busy || draft.pending || draft.outstanding} onClick={() => reset(a)}>{__uiText("รีเซ็ตรหัสผ่าน")}</Button>
                        <Button size="sm" variant={a.status === 'active' ? 'danger-ghost' : 'secondary'} icon={a.status === 'active' ? 'block' : 'check_circle'}
                          disabled={self || !!busy || draft.pending || draft.outstanding} onClick={() => toggle(a)}>
                          {a.status === 'active' ? __uiText("ปิดบัญชี") : __uiText("เปิดบัญชี")}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <Empty icon="group">{__uiText("ยังไม่มีบัญชีทีมงาน")}</Empty>
        )}
      </Panel>
    </Page>
  );
}
