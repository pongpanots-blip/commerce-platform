// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import {
  Alert, Button, Chip, CopyValue, Empty, ErrorText, Field, FormPanel, Input, Loading, Modal, Page, PageHeader, Panel, PanelHead, Select,
  StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { session, staffApi, StaffAccount, StaffRole } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const ROLE_LABEL: Record<StaffRole, string> = {
  get admin(){return __uiText("admin — ทุกเมนู");},
  get marketing(){return __uiText("marketing — รายงานและการตลาด");},
  get merchandising(){return __uiText("MER — สินค้า ราคา หมวด แบรนด์ supplier");},
  get cs(){return __uiText("CS — order shipment งาน CS credit note");},
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * commerce-admin › บัญชี staff (admin only). Accounts are commerce's own — no josh account needed.
 * A new account or a reset shows a temporary password once; it is not stored anywhere readable.
 */
export function StaffAccounts() {
  __useUiLocale();
  const me = session.claims()?.sub;
  const list = useAsync(() => staffApi.list(), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ email: string; name: string; role: StaffRole }>({ email: '', name: '', role: 'marketing' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handOver, setHandOver] = useState<{ email: string; password: string; what: string } | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const create = () => run('create', () => staffApi.create({ email: form.email.trim(), name: form.name.trim() || undefined, role: form.role }), (r) => {
    setHandOver({ email: r.account.email, password: r.temporaryPassword, what: 'สร้างบัญชีแล้ว' });
    setCreating(false);
    setForm({ email: '', name: '', role: 'marketing' });
  });
  const reset = (a: StaffAccount) => window.confirm(__uiText("รีเซ็ตรหัสผ่านของ {0}?\n\nรหัสเดิมใช้ไม่ได้ทันที", {"0": a.email}))
    && run(`reset:${a.id}`, () => staffApi.resetPassword(a.id), (r) => setHandOver({ email: a.email, password: r.temporaryPassword, what: 'รีเซ็ตรหัสผ่านแล้ว' }));
  const toggle = (a: StaffAccount) => window.confirm(__uiText(a.status === 'active' ? 'ปิดบัญชี {0}?\n\nออกจากระบบทันทีทุกเครื่อง' : 'เปิดบัญชี {0}?', { '0': a.email }))
    && run(`status:${a.id}`, () => staffApi.update(a.id, { status: a.status === 'active' ? 'disabled' : 'active' }));
  const setRole = (a: StaffAccount, role: StaffRole) => role !== a.role && window.confirm(__uiText("เปลี่ยน {0} เป็น {1}?", {"0": a.email, "1": role}))
    && run(`role:${a.id}`, () => staffApi.update(a.id, { role }));

  const rows = list.data ?? [];
  return (
    <Page>
      <PageHeader
        title={__uiText("บัญชีทีมงาน")}
        subtitle={__uiText("จัดการผู้ใช้แพลตฟอร์ม บทบาท และสิทธิ์การเข้าใช้งาน")}
        actions={
          <>
            <Button icon="refresh" onClick={list.reload}>{__uiText("รีเฟรช")}</Button>
            <Button variant="primary" icon="person_add" onClick={() => { setCreating(true); setError(null); }}>{__uiText("เพิ่มบัญชี")}</Button>
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
      <ErrorText error={(!creating && error) || list.error} />

      {creating && (
        <Modal title={__uiText("เพิ่มบัญชีทีมงาน")} onClose={() => { if (busy !== 'create') setCreating(false); }} width={640}><FormPanel title={__uiText("ข้อมูลบัญชีทีมงาน")} icon="person_add" busy={busy === 'create'} error={error} submitLabel={__uiText("สร้างบัญชี")} onSubmit={create} onCancel={() => setCreating(false)}
          description={__uiText("ระบบสร้างรหัสผ่านชั่วคราวให้ แสดงครั้งเดียวหลังกดสร้าง")}>
          <Field label={__uiText("อีเมล")}><Input type="email" required autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label={__uiText("ชื่อ")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={__uiText("สิทธิ์")}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
        </FormPanel></Modal>
      )}

      <Panel className="overflow-hidden">
        <PanelHead icon="group" title={__uiText("บัญชีทั้งหมด")} sub={list.data && __uiText("{0} ใช้งาน · {1} ทั้งหมด",{'0':rows.filter((a) => a.status === 'active').length,'1':rows.length})} />
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error && !list.data ? null : rows.length ? (
          <Table>
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
                      <Select aria-label={__uiText("สิทธิ์ของ {0}", {"0": a.email})} value={a.role} disabled={self || !!busy} onChange={(e) => setRole(a, e.target.value as StaffRole)}>
                        {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => <option key={r} value={r}>{r === 'merchandising' ? __uiText("MER") : r === 'cs' ? __uiText("CS") : r}</option>)}
                      </Select>
                    </TD>
                    <TD><StatusChip status={a.status} /></TD>
                    <TD kind="time">{fmt.when(a.createdAt)}</TD>
                    <TD kind="actions">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" icon="key" disabled={!!busy} onClick={() => reset(a)}>{__uiText("รีเซ็ตรหัสผ่าน")}</Button>
                        <Button size="sm" variant={a.status === 'active' ? 'danger-ghost' : 'secondary'} icon={a.status === 'active' ? 'block' : 'check_circle'}
                          disabled={self || !!busy} onClick={() => toggle(a)}>
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
