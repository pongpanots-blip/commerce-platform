// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert, Button, CopyableId, DetailHeader, DetailSection, Empty, ErrorText, KeyValueGrid, Loading, Page, Panel, StatusChip, TBody, TD, TH, THead, TR,
  Table, fmt,
} from '@cp/ui';
import { ordersApi, OrderFull, session } from '../../lib/api';
import { useAsync } from '../hooks';

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

  return (
    <Page>
      <DetailHeader
        back={{ to: '/orders', label: 'ออเดอร์' }}
        title={o ? o.code ?? __uiText("ออเดอร์ {0}", {"0": o.id.slice(0, 8)}) : __uiText("ออเดอร์")}
        status={o && <StatusChip status={o.status} />}
        facts={o ? [{ label: 'รหัสออเดอร์', value: <CopyableId value={o.id} /> }] : undefined}
        primary={o && <>
          {!readOnly && o.status === 'draft' && (
            <Button variant="primary" icon="shopping_cart_checkout" disabled={!!busy} onClick={() => run('checkout', 'ยืนยันออเดอร์แล้ว', () => ordersApi.checkout(o.id))}>
              {busy === 'checkout' ? '…' : __uiText("ยืนยันออเดอร์")}
            </Button>
          )}
          {!readOnly && o.status === 'pending_payment' && d?.payment?.status === 'pending' && (
            <Button variant="primary" icon="paid" disabled={!!busy} onClick={() => run('pay', 'บันทึกว่าชำระแล้ว', () => ordersApi.pay(d.payment!.id))}>
              {busy === 'pay' ? '…' : __uiText("บันทึกว่าชำระแล้ว")}
            </Button>
          )}
          <Button icon="refresh" onClick={detail.reload}>{__uiText("รีเฟรช")}</Button>
        </>}
        overflow={[
          ...(!readOnly && o && o.status === 'pending_payment' && d?.payment?.status === 'pending' ? [{ label: 'บันทึกว่าชำระไม่สำเร็จ', danger: true, onSelect: () => run('fail', 'บันทึกว่าชำระไม่สำเร็จ', () => ordersApi.failPay(d.payment!.id)) }] : []),
          ...(!readOnly && held && o ? [{ label: 'ปล่อยการจองสต็อก', danger: true, onSelect: () => run('release', 'ปล่อยการจองแล้ว', () => ordersApi.releaseReservations(o.id)) }] : []),
        ]}
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
                { label: 'รหัสออเดอร์', value: o.id, copy: true },
                { label: 'ลูกค้า', value: <Link className="font-mono text-[11px] text-on-surface-variant hover:underline" to={`/customers/${o.customerId}`}>{o.customerId}</Link> },
                { label: 'ยอดรวม', value: <span className="font-semibold">{money(o.currency, o.total)}</span> },
                { label: 'สร้างเมื่อ', value: fmt.when(o.createdAt) },
                { label: 'การชำระเงิน', value: d.payment ? <StatusChip status={d.payment.status} /> : '—' },
                { label: 'รหัสกันการส่งซ้ำ', value: o.idempotencyKey ?? '—', copy: true },
              ]}
            />
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
            <Panel className="p-4 space-y-5">
              <DetailSection title={__uiText("Lines ({0})", {"0": d.lines.length})} icon="receipt_long">
                {d.lines.length ? (
                  <Table>
                    <THead>
                      <TH>{__uiText("Product")}</TH>
                      <TH right>{__uiText("Qty")}</TH>
                      <TH right>{__uiText("Unit price")}</TH>
                      <TH right>{__uiText("Line total")}</TH>
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
                  <Empty>{__uiText("No lines")}</Empty>
                )}
              </DetailSection>

              <DetailSection title={__uiText("Reservations ({0})", {"0": d.reservations.length})} icon="inventory">
                {d.reservations.length ? (
                  <Table>
                    <THead>
                      <TH>{__uiText("SKU")}</TH>
                      <TH right>{__uiText("Qty")}</TH>
                      <TH>{__uiText("Status")}</TH>
                      <TH>{__uiText("External ref")}</TH>
                      <TH>{__uiText("Expires")}</TH>
                      <TH>{__uiText("Promised")}</TH>
                      <TH>{__uiText("Fail reason")}</TH>
                    </THead>
                    <TBody>
                      {d.reservations.map((r) => (
                        <TR key={r.id}>
                          <TD kind="mono">{r.sku}</TD>
                          <TD kind="num">{fmt.num(r.qty)}</TD>
                          <TD><StatusChip status={r.status} /></TD>
                          <TD kind="mono">{r.externalRef ?? '—'}</TD>
                          <TD kind="time">{r.expiresAt ? fmt.when(r.expiresAt) : '—'}</TD>
                          <TD kind="muted">{r.promisedDate ?? '—'}</TD>
                          <TD kind="muted">{r.failReason ?? '—'}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <Empty>{__uiText("No reservations")}</Empty>
                )}
              </DetailSection>
            </Panel>

            <div className="space-y-4">
              <Panel className="p-4">
                <DetailSection title={__uiText("Payment")} icon="payments">
                  {d.payment ? (
                    <KeyValueGrid
                      cols={2}
                      items={[
                        { label: 'Status', value: <StatusChip status={d.payment.status} /> },
                        { label: 'Method', value: d.payment.method ?? '—' },
                        { label: 'Amount', value: money(d.payment.currency, d.payment.amount) },
                      ]}
                    />
                  ) : (
                    <Empty icon="payments">{__uiText("No payment yet")}</Empty>
                  )}
                </DetailSection>
              </Panel>
              <Panel className="p-4">
                <DetailSection title={__uiText("Fulfillments ({0})", {"0": d.fulfillments.length})} icon="local_shipping">
                  {d.fulfillments.length ? (
                    <Table>
                      <THead>
                        <TH>{__uiText("Source")}</TH>
                        <TH>{__uiText("Mode")}</TH>
                        <TH>{__uiText("Status")}</TH>
                      </THead>
                      <TBody>
                        {d.fulfillments.map((f) => (
                          <TR key={f.id}>
                            <TD kind="mono">{f.source}</TD>
                            <TD kind="mono">{f.mode}</TD>
                            <TD><StatusChip status={f.status} /></TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  ) : (
                    <Empty icon="local_shipping">{__uiText("No fulfillments")}</Empty>
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
