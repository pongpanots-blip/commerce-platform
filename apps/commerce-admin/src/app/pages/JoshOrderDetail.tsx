import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Button, Chip, DetailSection, Empty, ErrorText, Field, FormPanel, Hint, Icon, Input, KeyValueGrid, Loading,
  Page, PageHeader, Panel, Pager, SearchInput, Segmented, Select, SectionTitle, Span, Stack2, StatusChip, StatusDot,
  TBody, TD, TH, THead, TR, Table, TitleBadge, fmt,
} from '@cp/ui';
import { joshOrderApi, JoshRow } from '../../lib/api';
import { useAsync } from '../hooks';
import { ORDER_STATUS, ORDER_TONE, PAYMENT_TONE, SYNC_DOT, paymentLabel, priceSourceLabel, syncLabel } from './JoshCommerce';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";

/** Order detail page (from expanded row). */
export function JoshOrderDetail() {
  __useUiLocale();
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const detail = useAsync(() => joshOrderApi.detail(id), [id]);
  const d = detail.data;

  const backTo = `${location.state?.from ?? '/reports/orders'}${location.state?.search ?? ''}`;

  return (
    <Page>
      <PageHeader
        back={{ to: backTo, label: 'รายงานออเดอร์' }}
        title={<span className="font-mono">{d ? d.order_number : id}</span>}
        badge={d && <Chip tone={ORDER_TONE[d.status] ?? 'muted'} dot>{ORDER_STATUS[d.status] ?? d.status}</Chip>}
        subtitle={d ? `${d.company_name ?? '—'} · ${d.branch_name ?? '—'} · ${fmt.when(d.create_date)}` : undefined}
      />

      <ErrorText error={detail.error} />

      {detail.loading && !d ? (
        <Loading />
      ) : !d ? (
        <Panel><Empty>{__uiText("ไม่พบออเดอร์")}</Empty></Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-4">
              <Panel className="p-4">
                <DetailSection title={__uiText("ข้อมูลออเดอร์")} icon="receipt_long">
                  <KeyValueGrid
                    items={[
                      { label: __uiText("วันส่ง"), value: d.delivery_date ?? '—' },
                      { label: __uiText("สั่งโดย"), value: d.orderedBy ? `${d.orderedBy.name.first_name} ${d.orderedBy.name.last_name ?? ''} (${d.orderedBy.email ?? d.orderedBy.phone ?? '—'})` : '—' },
                      { label: __uiText('เลขใบสั่งซื้อ (PO)'), value: d.po_number ?? '—', mono: true },
                      { label: __uiText("ก่อน VAT"), value: fmt.baht(d.subtotal_ex_vat) },
                      { label: 'VAT', value: fmt.baht(d.vat_amount) },
                      { label: __uiText("ส่วนลด"), value: fmt.baht(d.discount_inc_vat) },
                      { label: __uiText("ค่าส่ง"), value: fmt.baht(d.delivery_fee) },
                      { label: __uiText("ยอดรวม"), value: <span className="font-semibold">{fmt.baht(d.total_price)}</span> },
                    ]}
                  />
                </DetailSection>
              </Panel>

              <Panel className="p-4">
                <DetailSection title={__uiText("สินค้า ({0})", {"0": d.items?.length ?? 0})} icon="inventory_2">
                  {d.items && d.items.length ? (
                    <div className="rounded-lg border border-secondary-container overflow-hidden bg-surface-container-lowest">
                      <Table>
                        <THead>
                          <TH>{__uiText("รหัสสินค้า")}</TH>
                          <TH>{__uiText("สินค้า")}</TH>
                          <TH right>{__uiText("จำนวน")}</TH>
                          <TH right>{__uiText("ราคา/หน่วย")}</TH>
                          <TH>{__uiText("ที่มาราคา")}</TH>
                          <TH right>{__uiText("รวม")}</TH>
                        </THead>
                        <TBody>
                          {d.items.map((i: JoshRow) => (
                            <TR key={i.sku}>
                              <TD kind="mono">{i.sku}</TD>
                              <TD>{i.name}</TD>
                              <TD kind="num">{fmt.num(i.qty)}</TD>
                              <TD kind="money">{fmt.baht(i.unit_price)}</TD>
                              <TD kind="muted">{priceSourceLabel(i.price_source)}</TD>
                              <TD kind="money">{fmt.baht(i.line_revenue)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                  ) : (
                    <Hint>{__uiText("ไม่มีสินค้า")}</Hint>
                  )}
                </DetailSection>
              </Panel>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              <Panel className="p-4">
                <DetailSection title={__uiText("ส่งเข้า Jagota (ERP)")} icon="sync_alt">
                  {d.jagotaSync && d.jagotaSync.length ? (
                    <ol className="space-y-1.5 text-xs">
                      {d.jagotaSync.map((j: JoshRow, k: number) => (
                        <li key={k} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-on-surface-variant">{fmt.when(j.created_at)}</span>
                          <Chip tone={SYNC_DOT[j.sync_status] ?? 'muted'} dot>{syncLabel(j.sync_status)}</Chip>
                          {j.doc_no && <span className="font-mono text-[11px]">{j.doc_book}{j.doc_no}</span>}
                          {j.error_message && <span className="text-danger text-[11px]">{j.error_message}</span>}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Hint>{__uiText("ยังไม่เคยส่ง")}</Hint>
                  )}
                </DetailSection>
              </Panel>

              <Panel className="p-4">
                <DetailSection title={__uiText("จัดส่ง / ชำระเงิน")} icon="local_shipping">
                  <KeyValueGrid
                    cols={2}
                    items={[
                      {
                        label: __uiText('การจัดส่ง'),
                        value: d.shipments ? d.shipments.map((sh: JoshRow) => `${sh.shipment_number} ${__uiText(sh.delivered_at ? 'ส่งถึง' : sh.shipped_at ? 'ออกส่ง' : 'รอ')}`).join(' · ') : '—',
                      },
                      {
                        label: __uiText("ชำระ"),
                        value: d.payments ? d.payments.map((p: JoshRow) => `${paymentLabel(p.status)} ${fmt.baht(p.amount)} ${p.payment_method ?? ''}`).join(' · ') : '—',
                      },
                    ]}
                  />
                </DetailSection>
              </Panel>

              <Panel className="p-4">
                <DetailSection title={__uiText("สถานะชำระเงิน")} icon="payments">
                  <KeyValueGrid
                    cols={2}
                    items={[
                      {
                        label: __uiText("สถานะ"),
                        value: <Chip tone={PAYMENT_TONE(d.payment_status)} dot>{paymentLabel(d.payment_status)}</Chip>,
                      },
                      {
                        label: __uiText('ส่งเข้า Jagota'),
                        value: (
                          <StatusDot tone={d.jagota_sync_status ? SYNC_DOT[d.jagota_sync_status] ?? 'muted' : 'muted'}>
                            {syncLabel(d.jagota_sync_status)}
                            {d.doc_no && <span className="font-mono text-on-surface-variant">{d.doc_book}{d.doc_no}</span>}
                          </StatusDot>
                        ),
                      },
                      {
                        label: __uiText("ข้อผิดพลาด"),
                        value: d.jagota_error ? (
                          <span className="text-danger text-xs">{d.jagota_error}</span>
                        ) : (
                          '—'
                        ),
                      },
                    ]}
                  />
                </DetailSection>
              </Panel>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
