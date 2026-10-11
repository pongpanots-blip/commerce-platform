import { useState } from 'react';
import {
  Alert, Button, Chip, Empty, ErrorText, Loading, Page, PageHeader, Pager, Panel, PanelHead, Select, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { JOSH_ROLE_LABEL, JOSH_STAFF_ROLES, joshStaffApi, JoshStaffAccount } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const roleLabel = (role: string) => { const label = (JOSH_ROLE_LABEL as Record<string, string>)[role]; return label ? __uiText(label) : role; };

/**
 * commerce-admin › บัญชี josh (admin only, stage 6). The josh accounts staff still need (sales app, CS chat, josh-only
 * pages): role, on / off and "sign out everywhere" are decided here once commerce owns staff (COMMERCE_OWNS_STAFF);
 * josh applies them (staff.access) and sends the result back — until then the row shows "รอ josh".
 */
export function JoshStaff() {
  __useUiLocale();
  const owned = useAsync(() => joshStaffApi.ownership(), []);
  const list = useAsync(() => joshStaffApi.list(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const canEdit = !!owned.data?.staff;

  async function run(key: string, confirmText: string, fn: () => Promise<unknown>) {
    if (!window.confirm(__uiText("{0}\n\nระบบร้านค้าจะปรับตามภายในไม่กี่วินาที", {"0": confirmText}))) return;
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
    && run(`role:${a.id}`, __uiText('เปลี่ยนสิทธิ์ในร้านค้าของ {0} เป็น {1}?', { 0: a.email, 1: roleLabel(role) }), () => joshStaffApi.set(a.id, { role }));
  const toggle = (a: JoshStaffAccount) => run(`active:${a.id}`, __uiText(a.isActive ? 'ปิดบัญชีร้านค้าของ {0}?' : 'เปิดบัญชีร้านค้าของ {0}?', { 0: a.email }),
    () => joshStaffApi.set(a.id, a.isActive ? { isActive: false, revokeSessions: true } : { isActive: true }));
  const signOut = (a: JoshStaffAccount) => run(`out:${a.id}`, __uiText('ให้ {0} ออกจากระบบร้านค้าทุกเครื่อง?', { 0: a.email }), () => joshStaffApi.set(a.id, { revokeSessions: true }));

  const rows = list.data ?? [];
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return (
    <Page>
      <PageHeader
        title={__uiText("บัญชีทีมงานร้านค้า")}
        subtitle={__uiText("บัญชีทีมงานที่ใช้หลังร้านของร้านค้า")}
        actions={<Button icon="refresh" onClick={list.reload}>{__uiText("Refresh")}</Button>}
      />
      {owned.data && !canEdit && (
        <Alert tone="info" title={__uiText("ยังดูได้อย่างเดียว")}>
          {__uiText("ตอนนี้ระบบร้านค้ายังดูแลบัญชีทีมงานเอง จึงแก้จากหน้านี้ไม่ได้ อนุมัติคำขอใช้งานใหม่ได้ที่หน้า “คำขอใช้งานหลังร้าน”")}</Alert>
      )}
      <ErrorText error={error ?? list.error} />

      <Panel className="overflow-hidden">
        <PanelHead icon="badge" title={__uiText("ทีมงานในร้านค้า")} sub={list.data && __uiText("{0} ใช้งาน · {1} ทั้งหมด",{'0':rows.filter((a) => a.isActive).length,'1':rows.length})} />
        {list.loading && !list.data ? (
          <Loading />
        ) : rows.length ? (
          <>
          <Table>
            <THead>
              <TH>{__uiText("อีเมล")}</TH>
              <TH>{__uiText("ชื่อ")}</TH>
              <TH>{__uiText("สิทธิ์ในร้านค้า")}</TH>
              <TH>{__uiText("สถานะ")}</TH>
              <TH>{__uiText("เข้าแอปล่าสุด")}</TH>
              <TH kind="actions">{__uiText("จัดการ")}</TH>
            </THead>
            <TBody>
              {pageRows.map((a) => (
                <TR key={a.id}>
                  <TD kind="mono">{a.email ?? '—'}{a.pending && <Chip tone="warn" dot className="ml-2">{__uiText("รอระบบร้านค้า")}</Chip>}</TD>
                  <TD>{a.name || '—'}</TD>
                  <TD>
                    {canEdit ? (
                      <Select aria-label={__uiText("สิทธิ์ในร้านค้าของ {0}", {"0": a.email})} value={a.role} disabled={!!busy} onChange={(e) => setRole(a, e.target.value)}>
                        {!(JOSH_STAFF_ROLES as readonly string[]).includes(a.role) && <option value={a.role} disabled>{a.role}</option>}
                        {JOSH_STAFF_ROLES.map((r) => <option key={r} value={r}>{__uiText(JOSH_ROLE_LABEL[r])}</option>)}
                      </Select>
                    ) : roleLabel(a.role)}
                  </TD>
                  <TD><StatusChip status={a.isActive ? 'active' : 'disabled'} /></TD>
                  <TD kind="time">{a.lastAppLoginAt ? fmt.when(a.lastAppLoginAt) : '—'}</TD>
                  <TD kind="actions">
                    {canEdit && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" icon="logout" disabled={!!busy || !a.isActive} onClick={() => signOut(a)}>{__uiText("ออกจากระบบทุกเครื่อง")}</Button>
                        <Button size="sm" variant={a.isActive ? 'danger-ghost' : 'secondary'} icon={a.isActive ? 'block' : 'check_circle'} disabled={!!busy} onClick={() => toggle(a)}>
                          {a.isActive ? __uiText("ปิดบัญชี") : __uiText("เปิดบัญชี")}
                        </Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pager page={currentPage} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        ) : (
          <Empty icon="badge">{__uiText("ยังไม่มีข้อมูลทีมงานที่คัดลอกจากระบบร้านค้า ให้ผู้ดูแลระบบสั่งคัดลอกข้อมูลทีมงานก่อน แล้วกดรีเฟรช")}</Empty>
        )}
      </Panel>
    </Page>
  );
}
