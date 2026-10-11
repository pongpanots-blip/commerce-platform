import { useState } from 'react';
import { Button, Empty, ErrorText, Loading, Page, PageHeader, Panel, PanelHead, Pager, RowLink, Select, TBody, TD, TH, THead, TR, Table, confirmAction, fmt } from '@cp/ui';
import { api, Paginated, ReservationRow, ordersApi } from '../../lib/api';
import { useAsync } from '../hooks';
import { OrderStatusChip, fulfillmentModeLabel, orderStatusLabel } from './order-status';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUSES = ['', 'held', 'confirmed', 'released', 'expired', 'failed', 'reconcile'];

function remainingHint(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return __uiText('หมดเวลาแล้ว');
  const mins = Math.round(ms / 60000);
  return mins < 1 ? __uiText('เหลือไม่ถึง 1 นาที') : __uiText('เหลือ {0} นาที', { 0: mins });
}

export function Reservations() {
  __useUiLocale();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, loading, error, reload } = useAsync(
    () => api.get<Paginated<ReservationRow>>(
      `/reservations?page=${page}&pageSize=${pageSize}${status ? `&status=${status}` : ''}`),
    [page, status],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function release(orderId: string) {
    const ok = await confirmAction({
      title: 'ปล่อยการจองสต็อก',
      body: 'สินค้าที่จองไว้ทั้งหมดของออเดอร์นี้จะกลับเข้าสต็อก และอาจไม่มีของพอสำหรับออเดอร์นี้',
      confirmLabel: 'ปล่อยการจองสต็อก',
      danger: true,
    });
    if (!ok) return;
    setBusy(orderId);
    setActionError(null);
    try {
      await ordersApi.releaseReservations(orderId);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const total = data?.total ?? 0;

  return (
    <Page>
      <PageHeader
        title={__uiText("การจองสต็อกตอนชำระเงิน")}
        subtitle={__uiText("สต็อกที่ถูกจองระหว่างชำระเงิน ทั้งที่จอง ยืนยัน ปล่อย และหมดอายุ")}
        actions={<Button icon="refresh" variant="secondary" onClick={reload}>{__uiText("รีเฟรช")}</Button>}
      />

      <Panel>
        <PanelHead
          title={__uiText("รายการจองทั้งหมด")}
          sub={__uiText("{0} รายการ", {'0': total.toLocaleString()})}
          actions={
            <Select aria-label={__uiText("สถานะ")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-48">
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s ? orderStatusLabel(s) : __uiText("ทุกสถานะ")}</option>
              ))}
            </Select>
          }
        />
        <ErrorText error={error} />
        <ErrorText error={actionError} />
        {loading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty>{__uiText(status ? "ไม่มีรายการจองในสถานะนี้ ลองเลือกทุกสถานะ" : "ยังไม่มีการจองสต็อก รายการจะขึ้นเมื่อลูกค้าเริ่มชำระเงิน")}</Empty>
        ) : (
          <>
            <Table>
              <THead>
                <TH>{__uiText("รหัสสินค้า")}</TH>
                <TH right>{__uiText("จำนวน")}</TH>
                <TH>{__uiText("ที่มาของสินค้า")}</TH>
                <TH>{__uiText("สถานะ")}</TH>
                <TH>{__uiText("เลขอ้างอิงระบบหลัก (ERP)")}</TH>
                <TH>{__uiText("หมดเวลาจอง")}</TH>
                <TH>{__uiText("วันที่สัญญาส่ง")}</TH>
                <TH>{__uiText("เหตุผลที่ไม่สำเร็จ")}</TH>
                <TH>{__uiText("ออเดอร์")}</TH>
                <TH right>{__uiText("จัดการ")}</TH>
              </THead>
              <TBody>
                {data.items.map((r) => {
                  const remaining = remainingHint(r.expiresAt);
                  return (
                    <TR key={r.id}>
                      <TD kind="mono">{r.sku}</TD>
                      <TD kind="num">{fmt.num(r.qty)}</TD>
                      <TD>{fulfillmentModeLabel(r.mode)}</TD>
                      <TD><OrderStatusChip status={r.status} /></TD>
                      <TD kind="mono">{r.externalRef ?? '—'}</TD>
                      <TD kind="time">
                        {r.expiresAt ? fmt.when(r.expiresAt) : '—'}
                        {remaining && <div className="text-[10px] text-on-surface-variant">{remaining}</div>}
                      </TD>
                      <TD>{r.promisedDate ?? '—'}</TD>
                      <TD>{r.failReason ?? '—'}</TD>
                      <TD><RowLink to={`/orders/${r.orderId}`}>{r.orderId.slice(0, 8)}…</RowLink></TD>
                      <TD kind="actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={r.status !== 'held' || busy === r.orderId}
                          title={__uiText("ปล่อยการจองทุกรายการของออเดอร์นี้")}
                          onClick={() => void release(r.orderId)}
                        >
                          {busy === r.orderId ? '…' : __uiText("ปล่อยการจอง")}
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
          </>
        )}
      </Panel>
    </Page>
  );
}
