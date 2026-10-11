// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert, Button, DetailSection, Empty, ErrorText, KeyValueGrid, Loading, Page, PageHeader, Panel, TBody, TD, TH, THead, TR,
  Table, confirmAction, fmt,
} from '@cp/ui';
import { ordersApi, OrderFull, session } from '../../lib/api';
import { useAsync } from '../hooks';
import { OrderStatusChip, fulfillmentModeLabel, fulfillmentSourceLabel } from './order-status';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const money = (currency: string, v: string | number | null | undefined) => (v === null || v === undefined ? '—' : `${currency} ${fmt.num(v)}`);

/** One commerce order: checkout / payment / hold actions plus lines, fulfillments, reservations and payment. */
export function OrderDetail() {
  __useUiLocale();
  const { id = '' } = useParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const detail = useAsync<OrderFull>(() => ordersApi.full(id), [id]);

  async function run(key: string, label: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    setMsg('');
    try {
      await fn();
      setMsg(label);
      detail.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const d = detail.data;
  const o = d?.order;
  const held = d?.reservations.some((r) => r.status === 'held');
  const readOnly = session.claims()?.role === 'business_analyst';

  async function confirmThen(key: 'fail' | 'release') {
    if (!o || !d) return;
    if (key === 'fail') {
      const ok = await confirmAction({
        title: 'บันทึกว่าชำระไม่สำเร็จ',
        body: 'ออเดอร์นี้จะถูกทำเครื่องหมายว่าชำระเงินไม่สำเร็จ ลูกค้าต้องชำระใหม่',
        confirmLabel: 'บันทึกว่าชำระไม่สำเร็จ',
        danger: true,
      });
      if (ok && d.payment) void run('fail', 'บันทึกว่าชำระไม่สำเร็จ', () => ordersApi.failPay(d.payment!.id));
      return;
    }
    const ok = await confirmAction({
      title: 'ปล่อยการจองสต็อก',
      body: 'สินค้าที่จองไว้จะกลับเข้าสต็อก และอาจไม่มีของพอสำหรับออเดอร์นี้',
      confirmLabel: 'ปล่อยการจองสต็อก',
      danger: true,
    });
    if (ok) void run('release', 'ปล่อยการจองแล้ว', () => ordersApi.releaseReservations(o.id));
  }

  return (
    <Page>
      <PageHeader
        back={{ to: '/orders', label: 'ออเดอร์' }}
        title={o ? o.code ?? __uiText("ออเดอร์ {0}", {"0": o.id.slice(0, 8)}) : __uiText("ออเดอร์")}
        badge={o && <OrderStatusChip status={o.status} />}
        subtitle={__uiText("ยืนยันออเดอร์ บันทึกการชำระเงิน และดูการจองสต็อกของออเดอร์นี้")}
        actions={
          o && (
            <>
              {!readOnly && o.status === 'draft' && (
                <Button variant="primary" icon="shopping_cart_checkout" disabled={!!busy} onClick={() => run('checkout', 'ยืนยันออเดอร์แล้ว', () => ordersApi.checkout(o.id))}>
                  {busy === 'checkout' ? '…' : __uiText("ยืนยันออเดอร์")}
                </Button>
              )}
              {!readOnly && o.status === 'pending_payment' && d?.payment?.status === 'pending' && (
                <>
                  <Button variant="primary" icon="paid" disabled={!!busy} onClick={() => run('pay', 'บันทึกว่าชำระแล้ว', () => ordersApi.pay(d.payment!.id))}>
                    {busy === 'pay' ? '…' : __uiText("บันทึกว่าชำระแล้ว")}
                  </Button>
                  <Button variant="danger-ghost" icon="money_off" disabled={!!busy} onClick={() => void confirmThen('fail')}>
                    {busy === 'fail' ? '…' : __uiText("บันทึกว่าชำระไม่สำเร็จ")}
                  </Button>
                </>
              )}
              {!readOnly && held && (
                <Button icon="lock_open" disabled={!!busy} onClick={() => void confirmThen('release')}>
                  {busy === 'release' ? '…' : __uiText("ปล่อยการจองสต็อก")}
                </Button>
              )}
              <Button icon="refresh" onClick={detail.reload}>{__uiText("รีเฟรช")}</Button>
            </>
          )
        }
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={error || detail.error} />

      {detail.loading && !d ? (
        <Loading />
      ) : d && o ? (
        <>
          <Panel className="p-4">
            <KeyValueGrid
              items={[
                { label: 'รหัสออเดอร์', value: o.id, copy: true, mono: true },
                { label: 'ลูกค้า', value: <Link className="font-mono text-[11px] text-primary hover:underline" to={`/customers/${o.customerId}`}>{o.customerId}</Link> },
                { label: 'ยอดรวม', value: <span className="font-semibold tabular-nums">{money(o.currency, o.total)}</span> },
                { label: 'สร้างเมื่อ', value: fmt.when(o.createdAt) },
                { label: 'การชำระเงิน', value: d.payment ? <OrderStatusChip status={d.payment.status} /> : '—' },
                { label: 'รหัสกันการส่งซ้ำ', value: o.idempotencyKey ?? '—', copy: true, mono: true },
              ]}
            />
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
            <Panel className="p-4 space-y-5">
              <DetailSection title={__uiText("รายการสินค้า ({0})", {"0": d.lines.length})} icon="receipt_long">
                {d.lines.length ? (
                  <Table>
                    <THead>
                      <TH>{__uiText("สินค้า")}</TH>
                      <TH right>{__uiText("จำนวน")}</TH>
                      <TH right>{__uiText("ราคาต่อหน่วย")}</TH>
                      <TH right>{__uiText("รวม")}</TH>
                    </THead>
                    <TBody>
                      {d.lines.map((l) => (
                        <TR key={l.id}>
                          <TD><Link className="font-mono text-[11px] text-primary hover:underline" to={`/products/${l.productId}`}>{l.productId.slice(0, 8)}…</Link></TD>
                          <TD kind="num">{fmt.num(l.qty)}</TD>
                          <TD kind="money">{money(o.currency, l.unitPrice)}</TD>
                          <TD kind="money">{money(o.currency, l.lineTotal)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <Empty>{__uiText("ออเดอร์นี้ยังไม่มีรายการสินค้า")}</Empty>
                )}
              </DetailSection>

              <DetailSection title={__uiText("การจองสต็อก ({0})", {"0": d.reservations.length})} icon="inventory">
                {d.reservations.length ? (
                  <Table>
                    <THead>
                      <TH>{__uiText("รหัสสินค้า")}</TH>
                      <TH right>{__uiText("จำนวน")}</TH>
                      <TH>{__uiText("สถานะ")}</TH>
                      <TH>{__uiText("เลขอ้างอิงระบบหลัก (ERP)")}</TH>
                      <TH>{__uiText("หมดเวลาจอง")}</TH>
                      <TH>{__uiText("วันที่สัญญาส่ง")}</TH>
                      <TH>{__uiText("เหตุผลที่ไม่สำเร็จ")}</TH>
                    </THead>
                    <TBody>
                      {d.reservations.map((r) => (
                        <TR key={r.id}>
                          <TD kind="mono">{r.sku}</TD>
                          <TD kind="num">{fmt.num(r.qty)}</TD>
                          <TD><OrderStatusChip status={r.status} /></TD>
                          <TD kind="mono">{r.externalRef ?? '—'}</TD>
                          <TD kind="time">{r.expiresAt ? fmt.when(r.expiresAt) : '—'}</TD>
                          <TD kind="muted">{r.promisedDate ?? '—'}</TD>
                          <TD kind="muted">{r.failReason ?? '—'}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <Empty>{__uiText("ยังไม่มีการจองสต็อก ยืนยันออเดอร์เพื่อเริ่มจอง")}</Empty>
                )}
              </DetailSection>
            </Panel>

            <div className="space-y-4">
              <Panel className="p-4">
                <DetailSection title={__uiText("การชำระเงิน")} icon="payments">
                  {d.payment ? (
                    <KeyValueGrid
                      cols={2}
                      items={[
                        { label: 'สถานะ', value: <OrderStatusChip status={d.payment.status} /> },
                        { label: 'ช่องทาง', value: d.payment.method ?? '—', mono: !!d.payment.method },
                        { label: 'ยอดเงิน', value: <span className="tabular-nums">{money(d.payment.currency, d.payment.amount)}</span> },
                      ]}
                    />
                  ) : (
                    <Empty icon="payments">{__uiText("ยังไม่มีการชำระเงิน")}</Empty>
                  )}
                </DetailSection>
              </Panel>
              <Panel className="p-4">
                <DetailSection title={__uiText("การจัดหาสินค้า ({0})", {"0": d.fulfillments.length})} icon="local_shipping">
                  {d.fulfillments.length ? (
                    <Table>
                      <THead>
                        <TH>{__uiText("แหล่งสินค้า")}</TH>
                        <TH>{__uiText("ที่มาของสินค้า")}</TH>
                        <TH>{__uiText("สถานะ")}</TH>
                      </THead>
                      <TBody>
                        {d.fulfillments.map((f) => (
                          <TR key={f.id}>
                            <TD>{fulfillmentSourceLabel(f.source)}</TD>
                            <TD>{fulfillmentModeLabel(f.mode)}</TD>
                            <TD><OrderStatusChip status={f.status} /></TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  ) : (
                    <Empty icon="local_shipping">{__uiText("ยังไม่มีการจัดหาสินค้า ยืนยันออเดอร์เพื่อเริ่ม")}</Empty>
                  )}
                </DetailSection>
              </Panel>
            </div>
          </div>
        </>
      ) : null}
    </Page>
  );
}
