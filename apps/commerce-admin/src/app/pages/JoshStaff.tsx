import { useState } from 'react';
import {
  Alert, Button, Chip, Empty, ErrorText, Loading, Page, PageHeader, Panel, PanelHead, Select, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { JOSH_ROLE_LABEL, JOSH_STAFF_ROLES, joshStaffApi, JoshStaffAccount } from '../../lib/api';
import { useAsync } from '../hooks';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * commerce-admin › บัญชี josh (admin only, stage 6). The josh accounts staff still need (sales app, CS chat, josh-only
 * pages): role, on / off and "sign out everywhere" are decided here once commerce owns staff (COMMERCE_OWNS_STAFF);
 * josh applies them (staff.access) and sends the result back — until then the row shows "รอ josh".
 */
export function JoshStaff() {
  const owned = useAsync(() => joshStaffApi.ownership(), []);
  const list = useAsync(() => joshStaffApi.list(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = !!owned.data?.staff;

  async function run(key: string, confirmText: string, fn: () => Promise<unknown>) {
    if (!window.confirm(`${confirmText}\n\njosh จะทำตามภายในไม่กี่วินาที (ส่งผ่าน event)`)) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }
  const setRole = (a: JoshStaffAccount, role: string) => role !== a.role
    && run(`role:${a.id}`, `เปลี่ยนสิทธิ์ใน josh ของ ${a.email} เป็น ${role}?`, () => joshStaffApi.set(a.id, { role }));
  const toggle = (a: JoshStaffAccount) => run(`active:${a.id}`, `${a.isActive ? 'ปิด' : 'เปิด'}บัญชี josh ของ ${a.email}?`,
    () => joshStaffApi.set(a.id, a.isActive ? { isActive: false, revokeSessions: true } : { isActive: true }));
  const signOut = (a: JoshStaffAccount) => run(`out:${a.id}`, `ให้ ${a.email} ออกจากระบบ josh ทุกเครื่อง?`, () => joshStaffApi.set(a.id, { revokeSessions: true }));

  const rows = list.data ?? [];
  return (
    <Page>
      <PageHeader
        title="บัญชี josh (staff)"
        subtitle="บัญชีพนักงานที่ยังต้องใช้ใน josh — แอปฝ่ายขาย, แชต CS, หน้าที่ยังอยู่ josh · คนละบัญชีกับ commerce-admin"
        actions={<Button icon="refresh" onClick={list.reload}>Refresh</Button>}
      />
      {owned.data && !canEdit && (
        <Alert tone="info" title="ยังดูได้อย่างเดียว">
          josh ยังเป็นเจ้าของบัญชีพนักงาน (COMMERCE_OWNS_STAFF ยังไม่เปิด) — คำขอเข้าใช้ใหม่อนุมัติที่ "Admin access requests"
        </Alert>
      )}
      <ErrorText error={error ?? list.error} />

      <Panel className="overflow-hidden">
        <PanelHead icon="badge" title="พนักงานใน josh" sub={list.data && `${rows.filter((a) => a.isActive).length} ใช้งาน · ${rows.length} ทั้งหมด`} />
        {list.loading && !list.data ? (
          <Loading />
        ) : rows.length ? (
          <Table>
            <THead>
              <TH>อีเมล</TH>
              <TH>ชื่อ</TH>
              <TH>สิทธิ์ใน josh</TH>
              <TH>สถานะ</TH>
              <TH>เข้าแอปล่าสุด</TH>
              <TH kind="actions">จัดการ</TH>
            </THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.id}>
                  <TD kind="mono">{a.email ?? '—'}{a.pending && <Chip tone="warn" className="ml-2">รอ josh</Chip>}</TD>
                  <TD>{a.name || '—'}</TD>
                  <TD>
                    {canEdit ? (
                      <Select aria-label={`สิทธิ์ใน josh ของ ${a.email}`} value={a.role} disabled={!!busy} onChange={(e) => setRole(a, e.target.value)}>
                        {!(JOSH_STAFF_ROLES as readonly string[]).includes(a.role) && <option value={a.role} disabled>{a.role}</option>}
                        {JOSH_STAFF_ROLES.map((r) => <option key={r} value={r}>{JOSH_ROLE_LABEL[r]}</option>)}
                      </Select>
                    ) : a.role}
                  </TD>
                  <TD><StatusChip status={a.isActive ? 'active' : 'disabled'} /></TD>
                  <TD kind="time">{a.lastAppLoginAt ? fmt.when(a.lastAppLoginAt) : '—'}</TD>
                  <TD kind="actions">
                    {canEdit && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" icon="logout" disabled={!!busy || !a.isActive} onClick={() => signOut(a)}>ออกจากระบบทุกเครื่อง</Button>
                        <Button size="sm" variant={a.isActive ? 'danger-ghost' : 'secondary'} icon={a.isActive ? 'block' : 'check_circle'} disabled={!!busy} onClick={() => toggle(a)}>
                          {a.isActive ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                        </Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty icon="badge">ยังไม่มีสำเนาพนักงานจาก josh (staff.snapshot — backfill กลุ่ม staff)</Empty>
        )}
      </Panel>
    </Page>
  );
}
