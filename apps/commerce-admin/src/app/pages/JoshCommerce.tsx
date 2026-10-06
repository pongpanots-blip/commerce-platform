import { FormEvent, Fragment, ReactNode, useState } from 'react';
import {
  Button, Chip, Empty, ErrorText, Field, FormPanel, Icon, Input, Loading, Page, PageHeader, Panel, PanelHead, Pager,
  SearchInput, Select, SectionTitle, Span, StatGrid, StatTile, StatusChip, TBody, TD, TH, THead, TR, Table, fmt,
} from '@cp/ui';
import { joshActionsApi, JoshRow, joshCustomerApi, joshOrderApi, joshPriceApi } from '../../lib/api';
import { useAsync } from '../hooks';

const LIMIT = 50;

const ORDER_STATUS: Record<string, string> = { payment_pending: 'รอชำระ', paid: 'ชำระแล้ว', preparing: 'กำลังเตรียม', shipped: 'จัดส่งแล้ว', delivered: 'ส่งถึงแล้ว', cancelled: 'ยกเลิก', refunded: 'คืนเงิน' };
const SYNC: Record<string, [string, string]> = { sent: ['ส่งแล้ว', 'ok'], confirmed: ['ยืนยันแล้ว', 'ok'], reserved: ['จองแล้ว', 'ok'], skipped: ['ข้าม', 'muted'], pending: ['รอส่ง', 'warn'], failed: ['ส่งไม่สำเร็จ', 'danger'] };

function SyncChip({ s }: { s: string | null }) {
  if (!s) return <Chip tone="muted">ยังไม่ส่ง</Chip>;
  const [label, tone] = SYNC[s] ?? [s, 'muted'];
  return <Chip tone={tone as any}>{label}</Chip>;
}

/** josh orders, read-only: status, payment, and whether each reached Jagota. Orders are still created, paid and sent by josh. */
export function JoshOrdersPage() {
  const [draft, setDraft] = useState({ search: '', status: '', from: '', to: '' });
  const [f, setF] = useState({ ...draft, sync: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIMIT);
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAsync(() => joshOrderApi.summary({ ...f, sync: undefined }), [f.search, f.status, f.from, f.to]);
  // The 'payment_missing' tile filters by payment, not by Jagota state.
  const list = useAsync(() => joshOrderApi.list({ ...f, ...(f.sync === 'payment_missing' ? { sync: '', payment: 'missing' } : {}), page, limit: pageSize }), [f, page, pageSize]);
  const detail = useAsync(() => (open ? joshOrderApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const d = detail.data;

  return (
    <Page>
      <PageHeader
        title="Orders (josh)"
        subtitle="ออเดอร์หน้าร้าน · ส่งถึง Jagota (ERP) แล้วหรือยัง · ดูอย่างเดียว อ่านจาก replica ของ josh"
        actions={<Button icon="refresh" onClick={() => { summary.reload(); list.reload(); }}>Refresh</Button>}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={summary.error || list.error} />

      {s && (
        <div>
          <SectionTitle note="Click to filter; click again to clear">Status</SectionTitle>
          <StatGrid cols={3}>
            <StatTile
              accent
              tone={s.sync_failed > 0 ? 'danger' : 'ok'}
              icon={s.sync_failed > 0 ? 'error' : 'check_circle'}
              label="ส่ง Jagota ไม่สำเร็จ"
              value={fmt.num(s.sync_failed)}
              selected={f.sync === 'failed'}
              onClick={() => { setPage(1); setF({ ...f, sync: f.sync === 'failed' ? '' : 'failed' }); }}
            />
            <StatTile
              accent
              tone={s.sync_not_sent > 0 ? 'warn' : 'ok'}
              icon={s.sync_not_sent > 0 ? 'hourglass_top' : 'check_circle'}
              label="จ่ายแล้วแต่ยังไม่ส่ง Jagota"
              value={fmt.num(s.sync_not_sent)}
              selected={f.sync === 'not_sent'}
              onClick={() => { setPage(1); setF({ ...f, sync: f.sync === 'not_sent' ? '' : 'not_sent' }); }}
            />
            <StatTile
              tone="warn"
              icon="hourglass_top"
              label="รอส่ง Jagota"
              value={fmt.num(s.sync_pending)}
              selected={f.sync === 'pending'}
              onClick={() => { setPage(1); setF({ ...f, sync: f.sync === 'pending' ? '' : 'pending' }); }}
            />
            <StatTile
              tone="ok"
              icon="check_circle"
              label="ส่ง Jagota แล้ว"
              value={fmt.num(s.sync_sent)}
              selected={f.sync === 'sent'}
              onClick={() => { setPage(1); setF({ ...f, sync: f.sync === 'sent' ? '' : 'sent' }); }}
            />
            <StatTile
              accent
              tone={s.settled_without_payment > 0 ? 'warn' : 'ok'}
              icon={s.settled_without_payment > 0 ? 'warning' : 'check_circle'}
              label="สถานะจ่ายแล้ว/ส่งแล้ว แต่ไม่มีการจ่ายสำเร็จ"
              value={fmt.num(s.settled_without_payment)}
              selected={f.sync === 'payment_missing'}
              onClick={() => { setPage(1); setF({ ...f, sync: f.sync === 'payment_missing' ? '' : 'payment_missing' }); }}
            />
          </StatGrid>
          <div className="px-4 py-2 text-xs text-on-surface-variant">
            ทั้งหมด {fmt.num(s.total)} · รอชำระ {fmt.num(s.awaiting_payment)} · มูลค่าที่ชำระแล้ว {fmt.baht(s.paid_value)} · {s.byStatus.map((b: JoshRow) => `${ORDER_STATUS[b.status] ?? b.status} ${b.n}`).join(' · ')}
          </div>
        </div>
      )}

      <Panel className="overflow-hidden">
        <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setPage(1); setF({ ...draft, sync: f.sync }); }}>
          <Field label="ค้นหา" className="flex-1 min-w-48">
            <Input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder="เลข order / รหัสลูกค้า / PO / บริษัท" />
          </Field>
          <Field label="สถานะ">
            <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="ตั้งแต่">
            <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </Field>
          <Field label="ถึงก่อน">
            <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </Field>
          <Button type="submit">ค้นหา</Button>
        </form>
      </Panel>

      {list.loading && !list.data ? (
        <Loading />
      ) : list.data ? (
        <>
          <Panel className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>ลูกค้า</TH>
                  <TH>ยอด</TH>
                  <TH>สถานะ</TH>
                  <TH>ชำระ</TH>
                  <TH>Jagota</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((o) => (
                  <Fragment key={o.orders_id}>
                    <TR>
                      <TD kind="code">
                        {o.order_number}
                        <div className="text-[11px] text-on-surface-variant">{fmt.when(o.create_date)}</div>
                      </TD>
                      <TD>
                        {o.company_name ?? '—'}
                        <div className="text-[11px] text-on-surface-variant">{o.branch_name} · {o.customer_code}</div>
                      </TD>
                      <TD kind="money">{fmt.baht(o.total_price)}</TD>
                      <TD>{ORDER_STATUS[o.status] ?? o.status}</TD>
                      <TD>{o.payment_status ?? '—'}</TD>
                      <TD>
                        <SyncChip s={o.jagota_sync_status} />
                        {o.jagota_error && <div className="text-[11px] text-danger mt-1">{o.jagota_error}</div>}
                        {o.doc_no && <div className="font-mono text-[11px] text-on-surface-variant">{o.doc_book}{o.doc_no}</div>}
                      </TD>
                      <TD>
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === o.orders_id ? null : o.orders_id)}>
                          {open === o.orders_id ? 'ซ่อน' : 'รายละเอียด'}
                        </Button>
                      </TD>
                    </TR>
                    {open === o.orders_id && (
                      <TR>
                        <TD colSpan={7}>
                          {detail.error ? (
                            <ErrorText error={detail.error} />
                          ) : !d ? (
                            <Loading />
                          ) : (
                            <div className="space-y-3 p-4">
                              <div className="text-xs text-on-surface-variant">
                                ส่ง {d.delivery_date ?? '—'} · สั่งโดย {d.orderedBy.name.first_name} {d.orderedBy.name.last_name ?? ''} ({d.orderedBy.email ?? d.orderedBy.phone ?? '—'}) · ก่อน VAT {fmt.baht(d.subtotal_ex_vat)} · VAT {fmt.baht(d.vat_amount)} · ส่วนลด {fmt.baht(d.discount_inc_vat)} · ค่าส่ง {fmt.baht(d.delivery_fee)}
                              </div>
                              <Table>
                                <THead>
                                  <TR>
                                    <TH>SKU</TH>
                                    <TH>สินค้า</TH>
                                    <TH>จำนวน</TH>
                                    <TH>ราคา/หน่วย</TH>
                                    <TH>ที่มาราคา</TH>
                                    <TH>รวม</TH>
                                  </TR>
                                </THead>
                                <TBody>
                                  {d.items.map((i: JoshRow) => (
                                    <TR key={i.sku}>
                                      <TD kind="code">{i.sku}</TD>
                                      <TD>{i.name}</TD>
                                      <TD>{i.qty}</TD>
                                      <TD kind="money">{fmt.baht(i.unit_price)}</TD>
                                      <TD>{i.price_source}</TD>
                                      <TD kind="money">{fmt.baht(i.line_revenue)}</TD>
                                    </TR>
                                  ))}
                                </TBody>
                              </Table>
                              <div className="text-xs text-on-surface-variant">
                                Jagota: {d.jagotaSync.length ? d.jagotaSync.map((j: JoshRow) => `${fmt.when(j.created_at)} ${j.sync_status}${j.doc_no ? ` ${j.doc_book}${j.doc_no}` : ''}${j.error_message ? ` (${j.error_message})` : ''}`).join(' → ') : 'ยังไม่เคยส่ง'}
                              </div>
                              <div className="text-xs text-on-surface-variant">
                                Shipment: {d.shipments.map((sh: JoshRow) => `${sh.shipment_number} ${sh.delivered_at ? 'ส่งถึง' : sh.shipped_at ? 'ออกส่ง' : 'รอ'}`).join(' · ') || '—'} · ชำระ: {d.payments.map((p: JoshRow) => `${p.status} ${fmt.baht(p.amount)} ${p.payment_method ?? ''}`).join(' · ') || '—'}
                              </div>
                            </div>
                          )}
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          </Panel>
          <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
        </>
      ) : null}
    </Page>
  );
}

const KYC: Record<string, [string, string]> = { none: ['ไม่มีเอกสาร', 'muted'], pending: ['รอตรวจ', 'warn'], approved: ['ผ่าน', 'ok'], rejected: ['ไม่ผ่าน', 'danger'] };

/** josh business customers, read-only and masked like josh winback. */
export function JoshCustomersPage() {
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ search: '', issue: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIMIT);
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAsync(() => joshCustomerApi.summary(), []);
  const list = useAsync(() => joshCustomerApi.list({ ...f, page, limit: pageSize }), [f, page, pageSize]);
  const detail = useAsync(() => (open ? joshCustomerApi.detail(open) : Promise.resolve(null)), [open]);
  const s = summary.data;
  const d = detail.data;

  return (
    <Page>
      <PageHeader
        title="ลูกค้า / บริษัท (josh)"
        subtitle="บริษัท สาขา วงเงิน และ KYC · ข้อมูลส่วนบุคคลถูกปิดบังแบบเดียวกับ josh · ดูอย่างเดียว"
        actions={<Button icon="refresh" onClick={() => { summary.reload(); list.reload(); }}>Refresh</Button>}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={summary.error || list.error} />

      {s && (
        <div>
          <SectionTitle note="Click to filter; click again to clear">Issues</SectionTitle>
          <StatGrid cols={3}>
            <StatTile
              accent
              tone={s.kyc_pending > 0 ? 'warn' : 'ok'}
              icon={s.kyc_pending > 0 ? 'hourglass_top' : 'check_circle'}
              label="KYC รอตรวจ"
              value={fmt.num(s.kyc_pending)}
              selected={f.issue === 'kyc_pending'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'kyc_pending' ? '' : 'kyc_pending' }); }}
            />
            <StatTile
              tone="info"
              icon="info"
              label="ยังไม่ส่ง KYC"
              value={fmt.num(s.kyc_none)}
              selected={f.issue === 'kyc_none'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'kyc_none' ? '' : 'kyc_none' }); }}
            />
            <StatTile
              accent
              tone={s.credit_application_pending > 0 ? 'warn' : 'ok'}
              icon={s.credit_application_pending > 0 ? 'hourglass_top' : 'check_circle'}
              label="ขอวงเงินค้าง"
              value={fmt.num(s.credit_application_pending)}
              selected={f.issue === 'credit_application_pending'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'credit_application_pending' ? '' : 'credit_application_pending' }); }}
            />
            <StatTile
              accent
              tone={s.over_credit > 0 ? 'danger' : 'ok'}
              icon={s.over_credit > 0 ? 'error' : 'check_circle'}
              label="เกินวงเงิน"
              value={fmt.num(s.over_credit)}
              selected={f.issue === 'over_credit'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'over_credit' ? '' : 'over_credit' }); }}
            />
            <StatTile
              tone="warn"
              icon="warning"
              label="ใกล้เต็มวงเงิน (≥90%)"
              value={fmt.num(s.near_credit)}
              selected={f.issue === 'near_credit'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'near_credit' ? '' : 'near_credit' }); }}
            />
            <StatTile
              accent
              tone={s.no_erp_code > 0 ? 'danger' : 'ok'}
              icon={s.no_erp_code > 0 ? 'error' : 'check_circle'}
              label="ไม่มีรหัสลูกค้า ERP"
              value={fmt.num(s.no_erp_code)}
              selected={f.issue === 'no_erp_code'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'no_erp_code' ? '' : 'no_erp_code' }); }}
            />
          </StatGrid>
          <div className="px-4 py-2 text-xs text-on-surface-variant">
            {s.total} บริษัท · ใช้วงเงินรวม {fmt.baht(s.credit_used_total)} / {fmt.baht(s.credit_limit_total)}
          </div>
        </div>
      )}

      <Panel className="overflow-hidden">
        <form className="p-4 flex gap-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setF({ ...f, search: search.trim() }); }}>
          <Input
            className="flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ชื่อบริษัท หรือรหัสลูกค้า ERP"
          />
          <Button type="submit">ค้นหา</Button>
        </form>
      </Panel>

      {list.loading && !list.data ? (
        <Loading />
      ) : list.data ? (
        <>
          <Panel className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>บริษัท</TH>
                  <TH>รหัส ERP</TH>
                  <TH>วงเงิน</TH>
                  <TH>เครดิต</TH>
                  <TH>สาขา / คน</TH>
                  <TH>KYC</TH>
                  <TH>สั่งล่าสุด</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((c) => {
                  const over = c.credit_limit > 0 && c.credit_used > c.credit_limit;
                  const [kl, kc] = KYC[c.kyc_status] ?? [c.kyc_status, 'muted'];
                  return (
                    <Fragment key={c.id}>
                      <TR>
                        <TD>
                          {c.name}
                          <div className="font-mono text-[11px] text-on-surface-variant">{c.register_number}</div>
                        </TD>
                        <TD kind="code">{c.erp_customer_code ?? <Chip tone="warn">ไม่มี</Chip>}</TD>
                        <TD kind="money">
                          {fmt.baht(c.credit_used)} / {fmt.baht(c.credit_limit)}
                          {over && <div className="mt-1"><Chip tone="danger">เกินวงเงิน</Chip></div>}
                        </TD>
                        <TD>{c.credit_term_days ? `${c.credit_term_days} วัน` : 'เงินสด'}</TD>
                        <TD>{c.branch_count} / {c.user_count}</TD>
                        <TD><Chip tone={kc as any}>{kl}</Chip></TD>
                        <TD>{fmt.when(c.last_order_at)}</TD>
                        <TD>
                          <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>
                            {open === c.id ? 'ซ่อน' : 'รายละเอียด'}
                          </Button>
                        </TD>
                      </TR>
                      {open === c.id && (
                        <TR>
                          <TD colSpan={8}>
                            {detail.error ? (
                              <ErrorText error={detail.error} />
                            ) : !d ? (
                              <Loading />
                            ) : (
                              <div className="space-y-4 p-4">
                                <div className="text-xs text-on-surface-variant">
                                  โทร {d.phone ?? '—'} · ออเดอร์ {d.orders?.orders ?? 0} รายการ · ยอดที่ชำระแล้ว {fmt.baht(d.orders?.paid_value)}
                                </div>
                                <CustomerEdit
                                  kind="companies"
                                  id={d.id}
                                  label={`บริษัท ${d.name}`}
                                  onDone={() => { detail.reload(); list.reload(); }}
                                  fields={[['name', 'ชื่อบริษัท', d.name], ['credit_limit', 'วงเงิน (บาท)', d.credit_limit, 'number'], ['credit_term_days', 'เครดิต (วัน)', d.credit_term_days, 'number'], ['address', 'ที่อยู่', null], ['phone', 'โทร', null]]}
                                />
                                <Table>
                                  <THead>
                                    <TR>
                                      <TH>สาขา</TH>
                                      <TH>รหัส ERP</TH>
                                      <TH>sync</TH>
                                      <TH>วันส่ง</TH>
                                      <TH>โทร</TH>
                                      <TH />
                                    </TR>
                                  </THead>
                                  <TBody>
                                    {d.branches.map((b: JoshRow) => (
                                      <TR key={b.id}>
                                        <TD>
                                          {b.name}
                                          {b.is_default_delivery && <Chip tone="info" className="ml-2">หลัก</Chip>}
                                        </TD>
                                        <TD kind="code">{b.erp_branch_code ?? '—'}</TD>
                                        <TD>{b.erp_sync_status ?? '—'}</TD>
                                        <TD>{b.delivery_days ?? '—'}</TD>
                                        <TD>{b.phone ?? '—'}</TD>
                                        <TD>
                                          <CustomerEdit
                                            kind="branches"
                                            id={b.id}
                                            label={`สาขา ${b.name}`}
                                            onDone={detail.reload}
                                            fields={[['name', 'ชื่อสาขา', b.name], ['recipient_name', 'ผู้รับ', null], ['phone', 'โทร', null], ['delivery_address', 'ที่อยู่ส่ง', null]]}
                                          />
                                        </TD>
                                      </TR>
                                    ))}
                                  </TBody>
                                </Table>
                                <Table>
                                  <THead>
                                    <TR>
                                      <TH>ผู้ใช้</TH>
                                      <TH>อีเมล</TH>
                                      <TH>โทร</TH>
                                      <TH>role</TH>
                                      <TH>เข้าแอปล่าสุด</TH>
                                      <TH />
                                    </TR>
                                  </THead>
                                  <TBody>
                                    {d.users.map((u: JoshRow) => (
                                      <TR key={u.id}>
                                        <TD>
                                          {u.first_name} {u.last_name ?? ''}
                                          {!u.is_active && <Chip tone="muted" className="ml-2">ปิด</Chip>}
                                        </TD>
                                        <TD>{u.email ?? '—'}</TD>
                                        <TD>{u.mobile_phone ?? '—'}</TD>
                                        <TD>{u.role}</TD>
                                        <TD>{fmt.when(u.last_app_login_at)}</TD>
                                        <TD>
                                          <CustomerEdit
                                            kind="users"
                                            id={u.id}
                                            label="ผู้ใช้นี้"
                                            onDone={detail.reload}
                                            fields={[['first_name', 'ชื่อ', null], ['last_name', 'นามสกุล', null], ['email', 'อีเมล', null], ['mobile_phone', 'มือถือ', null]]}
                                          />
                                        </TD>
                                      </TR>
                                    ))}
                                  </TBody>
                                </Table>
                                <div className="text-xs text-on-surface-variant">
                                  KYC: {d.kycDocuments.map((k: JoshRow) => `${k.document_type} ${KYC[k.status]?.[0] ?? k.status}${k.rejection_reason ? ` (${k.rejection_reason})` : ''}`).join(' · ') || 'ยังไม่มีเอกสาร'}
                                </div>
                                <div className="text-xs text-on-surface-variant">
                                  ขอวงเงิน: {d.creditApplications.map((a: JoshRow) => `${a.status} ขอ ${fmt.baht(a.requested_credit_limit)} / ${a.requested_term_days} วัน${a.approved_credit_limit ? ` → อนุมัติ ${fmt.baht(a.approved_credit_limit)}` : ''}`).join(' · ') || '—'}
                                </div>
                              </div>
                            )}
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </Panel>
          <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
        </>
      ) : null}
    </Page>
  );
}

const SOURCE: Record<string, string> = { customer_sku: 'ราคาเฉพาะบริษัท', contract_sku: 'ราคาสัญญาสาขา', promotion: 'ราคาพิเศษสาขา', promotion_mechanic: 'โปรโมชัน', base: 'ราคาปกติ' };
const rowsText = (rows: JoshRow[]) => rows.map((r) => `${fmt.baht(r.price)} (${r.start_date ?? '…'} – ${r.end_date ?? '…'})`).join(', ') || '—';

/** What a josh customer branch pays per unit today, layer by layer in josh's order, plus its ERP quotations. */
export function JoshPricesPage() {
  const [branchSearch, setBranchSearch] = useState('');
  const [bq, setBq] = useState('');
  const branches = useAsync(() => joshPriceApi.branches(bq), [bq]);
  const [branch, setBranch] = useState<JoshRow | null>(null);
  const [sku, setSku] = useState('');
  const [skuQ, setSkuQ] = useState('');
  const prices = useAsync(() => (branch ? joshPriceApi.forBranch(branch.branch_id, skuQ) : Promise.resolve(null)), [branch?.branch_id, skuQ]);
  const quotes = useAsync(() => (branch?.erp_customer_code ? joshPriceApi.quotations(branch.erp_customer_code) : Promise.resolve([])), [branch?.erp_customer_code]);

  return (
    <Page>
      <PageHeader
        title="ราคาที่ลูกค้าเห็น (josh)"
        subtitle="เลือกสาขา → ราคาต่อหน่วยที่ josh คิดวันนี้ ทีละชั้นตามลำดับของ josh และ quotation จาก ERP · ดูอย่างเดียว"
        actions={<Button icon="refresh" onClick={() => { branches.reload(); prices.reload(); quotes.reload(); }}>Refresh</Button>}
      />
      <div className="border-t border-secondary-container" />

      <Panel>
        <form className="space-y-3 p-4">
          <Field label="ค้นหา">
            <Input
              value={branchSearch}
              onChange={(e) => setBranchSearch(e.target.value)}
              placeholder="ค้นหาบริษัท / สาขา / รหัสลูกค้า ERP"
            />
          </Field>
          <Button type="button" onClick={() => setBq(branchSearch.trim())}>ค้นหาสาขา</Button>
        </form>
        {branches.error && <ErrorText error={branches.error} />}
        <div className="flex flex-wrap gap-2 p-4">
          {(branches.data ?? []).slice(0, 30).map((b) => (
            <Button
              key={b.branch_id}
              size="sm"
              variant={branch?.branch_id === b.branch_id ? 'primary' : 'secondary'}
              onClick={() => setBranch(b)}
            >
              {b.company_name ?? '—'} · {b.branch_name}
            </Button>
          ))}
        </div>
      </Panel>

      {branch && (
        <>
          <Panel>
            <PanelHead title={`${branch.company_name} · ${branch.branch_name}`} sub={<span className="font-mono text-xs">{branch.erp_customer_code}</span>} />
            <form className="space-y-3 p-4">
              <Field label="SKU">
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="ว่าง = เฉพาะสินค้าที่มีราคาเฉพาะลูกค้า · หรือพิมพ์ SKU / ชื่อเพื่อดูสินค้าใดก็ได้"
                />
              </Field>
              <Button type="button" variant="ghost" onClick={() => setSkuQ(sku.trim())}>แสดง</Button>
            </form>
            {prices.error && <ErrorText error={prices.error} />}
            {prices.loading && !prices.data ? (
              <Loading />
            ) : prices.data && prices.data.items.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>SKU</TH>
                    <TH>สินค้า</TH>
                    <TH>ราคาปกติ</TH>
                    <TH>เฉพาะบริษัท</TH>
                    <TH>สัญญาสาขา</TH>
                    <TH>พิเศษสาขา</TH>
                    <TH>ขั้นบันได</TH>
                    <TH>วันนี้ลูกค้าจ่าย</TH>
                  </TR>
                </THead>
                <TBody>
                  {prices.data.items.map((p) => (
                    <TR key={p.id}>
                      <TD kind="code">{p.sku}</TD>
                      <TD>{p.name}</TD>
                      <TD kind="money">{fmt.baht(p.base)}</TD>
                      <TD>{rowsText(p.layers.privatePrice)}</TD>
                      <TD>{rowsText(p.layers.contract)}</TD>
                      <TD>{rowsText(p.layers.branchSpecial)}</TD>
                      <TD>{p.layers.qtyRules.map((r: JoshRow) => `${r.min_qty}${r.max_qty ? `–${r.max_qty}` : '+'}: ${fmt.baht(r.promotion_price)}`).join(', ') || (p.layers.hasActiveMechanic ? 'มีโปรโมชัน' : '—')}</TD>
                      <TD>
                        <strong>{p.winner.price == null ? 'คำนวณที่ josh' : fmt.baht(p.winner.price)}</strong>
                        <div className="text-[11px] text-on-surface-variant">{SOURCE[p.winner.source] ?? p.winner.source}</div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : prices.data ? (
              <Empty>ไม่มีราคาเฉพาะลูกค้าสำหรับสาขานี้ — พิมพ์ SKU เพื่อดูสินค้าอื่น</Empty>
            ) : null}
            {prices.data && <div className="px-4 py-3 text-xs text-on-surface-variant border-t border-secondary-container">{prices.data.note}</div>}
          </Panel>

          <Panel>
            <PanelHead title={`Quotation จาก ERP (${branch.erp_customer_code ?? 'ไม่มีรหัสลูกค้า'})`} />
            {quotes.loading && !quotes.data ? (
              <Loading />
            ) : quotes.data && quotes.data.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>สินค้า</TH>
                    <TH>ราคา</TH>
                    <TH>หน่วย</TH>
                    <TH>ใช้ได้</TH>
                    <TH>สถานะ</TH>
                    <TH>เอกสาร</TH>
                  </TR>
                </THead>
                <TBody>
                  {quotes.data.map((q, i) => (
                    <TR key={i}>
                      <TD>
                        {q.name}
                        <div className="font-mono text-[11px] text-on-surface-variant">{q.product_code}</div>
                      </TD>
                      <TD kind="money">{fmt.baht(q.rate)}</TD>
                      <TD>{q.unit}</TD>
                      <TD>{q.start_date ?? '…'} – {q.expiry_date ?? '…'}</TD>
                      <TD><Chip tone={q.status === 'Y' ? 'ok' : 'muted'}>{q.status === 'Y' ? 'ใช้งาน' : q.status === 'Z' ? 'ยกเลิก' : q.status}</Chip></TD>
                      <TD kind="code">{q.doc_book}{q.doc_no}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : quotes.data ? (
              <Empty>ไม่มี quotation</Empty>
            ) : null}
          </Panel>
        </>
      )}
    </Page>
  );
}

/**
 * Edit customer data through josh (COMMERCE_OWNS_CUSTOMERS). Masked values start empty: fill a field only to
 * change it. josh validates with its own DTOs; company edits (credit limit / term) need an admin role in josh.
 */
function CustomerEdit({ kind, id, label, fields, onDone }: {
  kind: 'users' | 'branches' | 'companies'; id: string; label: string; onDone: () => void;
  fields: [key: string, label: string, current: unknown, type?: 'number'][];
}) {
  const start = () => Object.fromEntries(fields.map(([k, , v]) => [k, v == null ? '' : String(v)]));
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!v) return <Button size="sm" variant="ghost" onClick={() => setV(start())}>แก้</Button>;

  const initial = start();
  const changed = fields.filter(([k]) => v[k].trim() !== '' && v[k] !== initial[k]);

  async function save() {
    const changes: Record<string, unknown> = {};
    for (const [k, l, , type] of changed) {
      if (type === 'number') {
        const n = Number(v![k]);
        if (!Number.isFinite(n) || n < 0) return setErr(`${l}: ต้องเป็นตัวเลขไม่ติดลบ`);
        changes[k] = n;
      } else changes[k] = v![k].trim();
    }
    if (!window.confirm(`บันทึก ${label}: ${changed.map(([, l]) => l).join(', ')}?\n\njosh บันทึกจริงในชื่อบัญชี josh ที่อีเมลตรงกับคุณ`)) return;
    setBusy(true); setErr('');
    try { await joshActionsApi.updateCustomer(kind, id, changes); setV(null); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <FormPanel
      title={label}
      icon="edit"
      cols={1}
      error={err}
      busy={busy}
      onSubmit={save}
      onCancel={() => setV(null)}
      description="ว่าง = ไม่เปลี่ยนค่า"
    >
      {fields.map(([k, l, , type]) => (
        <Field key={k} label={l} hint={initial[k] === '' ? ' (ว่าง = คงเดิม)' : undefined}>
          <Input
            inputMode={type === 'number' ? 'decimal' : undefined}
            type={k === 'email' ? 'email' : 'text'}
            value={v[k]}
            onChange={(e) => setV({ ...v, [k]: e.target.value })}
          />
        </Field>
      ))}
    </FormPanel>
  );
}
