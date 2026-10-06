import { useState } from 'react';
import {
  Alert, Button, Chip, CopyValue, Empty, ErrorText, Field, FormPanel, Input, Loading, Page, PageHeader, Panel, PanelHead, Select,
  StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { session, staffApi, StaffAccount, StaffRole } from '../../lib/api';
import { useAsync } from '../hooks';

const ROLE_LABEL: Record<StaffRole, string> = { admin: 'admin — ทุกเมนู', marketing: 'marketing — รายงานและการตลาด' };
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * commerce-admin › บัญชี staff (admin only). Accounts are commerce's own — no josh account needed.
 * A new account or a reset shows a temporary password once; it is not stored anywhere readable.
 */
export function StaffAccounts() {
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
  const reset = (a: StaffAccount) => window.confirm(`รีเซ็ตรหัสผ่านของ ${a.email}?\n\nรหัสเดิมใช้ไม่ได้ทันที`)
    && run(`reset:${a.id}`, () => staffApi.resetPassword(a.id), (r) => setHandOver({ email: a.email, password: r.temporaryPassword, what: 'รีเซ็ตรหัสผ่านแล้ว' }));
  const toggle = (a: StaffAccount) => window.confirm(`${a.status === 'active' ? 'ปิด' : 'เปิด'}บัญชี ${a.email}?${a.status === 'active' ? '\n\nออกจากระบบทันทีทุกเครื่อง' : ''}`)
    && run(`status:${a.id}`, () => staffApi.update(a.id, { status: a.status === 'active' ? 'disabled' : 'active' }));
  const setRole = (a: StaffAccount, role: StaffRole) => role !== a.role && window.confirm(`เปลี่ยน ${a.email} เป็น ${role}?`)
    && run(`role:${a.id}`, () => staffApi.update(a.id, { role }));

  const rows = list.data ?? [];
  return (
    <Page>
      <PageHeader
        title="บัญชี staff"
        subtitle="ผู้ใช้ commerce-admin และ MCP · บัญชีของ commerce เอง ไม่ต้องมีบัญชี josh"
        actions={
          <>
            {!creating && <Button variant="primary" icon="person_add" onClick={() => { setCreating(true); setError(null); }}>เพิ่มบัญชี</Button>}
            <Button icon="refresh" onClick={list.reload}>Refresh</Button>
          </>
        }
      />

      {handOver && (
        <Alert tone="ok" title={`${handOver.what}: ${handOver.email}`} onClose={() => setHandOver(null)}>
          <div className="space-y-2">
            <div>รหัสผ่านชั่วคราว (แสดงครั้งเดียว — ส่งให้เจ้าของบัญชีทางช่องทางส่วนตัว แล้วให้เปลี่ยนที่เมนู "เปลี่ยนรหัสผ่าน"):</div>
            <CopyValue value={handOver.password} />
          </div>
        </Alert>
      )}
      <ErrorText error={error ?? list.error} />

      {creating && (
        <FormPanel title="เพิ่มบัญชี staff" icon="person_add" busy={busy === 'create'} submitLabel="สร้างบัญชี" onSubmit={create} onCancel={() => setCreating(false)}
          description="ระบบสร้างรหัสผ่านชั่วคราวให้ แสดงครั้งเดียวหลังกดสร้าง">
          <Field label="อีเมล"><Input type="email" required autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="ชื่อ"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="สิทธิ์">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </Field>
        </FormPanel>
      )}

      <Panel className="overflow-hidden">
        <PanelHead icon="group" title="บัญชีทั้งหมด" sub={list.data && `${rows.filter((a) => a.status === 'active').length} ใช้งาน · ${rows.length} ทั้งหมด`} />
        {list.loading && !list.data ? (
          <Loading />
        ) : rows.length ? (
          <Table>
            <THead>
              <TH>อีเมล</TH>
              <TH>ชื่อ</TH>
              <TH>สิทธิ์</TH>
              <TH>สถานะ</TH>
              <TH>สร้างเมื่อ</TH>
              <TH kind="actions">จัดการ</TH>
            </THead>
            <TBody>
              {rows.map((a) => {
                const self = a.id === me;
                return (
                  <TR key={a.id}>
                    <TD kind="mono">{a.email}{self && <Chip tone="info" className="ml-2">คุณ</Chip>}</TD>
                    <TD>{a.name ?? '—'}</TD>
                    <TD>
                      <Select aria-label={`สิทธิ์ของ ${a.email}`} value={a.role} disabled={self || !!busy} onChange={(e) => setRole(a, e.target.value as StaffRole)}>
                        <option value="admin">admin</option>
                        <option value="marketing">marketing</option>
                      </Select>
                    </TD>
                    <TD><StatusChip status={a.status} /></TD>
                    <TD kind="time">{fmt.when(a.createdAt)}</TD>
                    <TD kind="actions">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" icon="key" disabled={!!busy} onClick={() => reset(a)}>รีเซ็ตรหัสผ่าน</Button>
                        <Button size="sm" variant={a.status === 'active' ? 'danger-ghost' : 'secondary'} icon={a.status === 'active' ? 'block' : 'check_circle'}
                          disabled={self || !!busy} onClick={() => toggle(a)}>
                          {a.status === 'active' ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <Empty icon="group">ยังไม่มีบัญชี staff</Empty>
        )}
      </Panel>
    </Page>
  );
}
