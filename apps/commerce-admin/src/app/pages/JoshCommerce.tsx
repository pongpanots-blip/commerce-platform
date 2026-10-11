import { SalesRepFilter } from '../components/SalesRepFilter';
// ui-metadata-migration: static labels and UI notices only
import { FormEvent, Fragment, ReactNode, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button, Chip, DetailSection, Empty, ErrorText, ExpandRow, ExpandToggle, Field, FilterChip, FormPanel, Hint, Icon, Input, KeyValueGrid, Loading,
  Page, PageHeader, Panel, PanelHead, Pager, SearchInput, Segmented, Select, SectionTitle, Span, Stack2, StatGrid, StatTile, StatusChip, StatusDot,
  TBody, TD, TH, THead, TR, Table, TitleBadge, fmt, RowLink, downloadCsv } from '@cp/ui';
import { joshActionsApi, JoshRow, joshCustomerApi, joshOrderApi, joshPriceApi, session } from '../../lib/api';
import { useAsync } from '../hooks';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const LIMIT = 50;

const ORDER_STATUS: Record<string, string> = { get payment_pending(){return __uiText("รอชำระ");}, get paid(){return __uiText("ชำระแล้ว");}, get preparing(){return __uiText("กำลังเตรียม");}, get shipped(){return __uiText("จัดส่งแล้ว");}, get delivered(){return __uiText("ส่งถึงแล้ว");}, get cancelled(){return __uiText("ยกเลิก");}, get refunded(){return __uiText("คืนเงิน");} };
const SYNC: Record<string, [string, string]> = { sent: ['ส่งแล้ว', 'ok'], confirmed: ['ยืนยันแล้ว', 'ok'], reserved: ['จองแล้ว', 'ok'], skipped: ['ข้าม', 'muted'], pending: ['รอส่ง', 'warn'], failed: ['ส่งไม่สำเร็จ', 'danger'] };

function SyncChip({ s }: { s: string | null }) {
  __useUiLocale();
  if (!s) return <Chip tone="muted">{__uiText("ยังไม่ส่ง")}</Chip>;
  const [label, tone] = SYNC[s] ?? [s, 'muted'];
  return <Chip tone={tone as any}>{label}</Chip>;
}

/** josh orders, read-only: status, payment, and whether each reached Jagota. Orders are still created, paid and sent by josh.
 *  Stitch screen: docs/design/stitch/admin-list-table.html */
const SYNC_TILES: { key: string; label: string; field: string; tone: 'danger' | 'warn' | 'ok' }[] = [
  { key: 'failed', get label() { return __uiText("ส่ง Jagota ไม่สำเร็จ"); }, field: 'sync_failed', tone: 'danger' },
  { key: 'not_sent', get label() { return __uiText("จ่ายแล้วแต่ยังไม่ส่ง Jagota"); }, field: 'sync_not_sent', tone: 'warn' },
  { key: 'pending', get label() { return __uiText("รอส่ง Jagota"); }, field: 'sync_pending', tone: 'warn' },
  { key: 'sent', get label() { return __uiText("ส่ง Jagota แล้ว"); }, field: 'sync_sent', tone: 'ok' },
  // 'payment_missing' filters by payment, not by Jagota state.
  { key: 'payment_missing', get label() { return __uiText("จ่ายแล้ว/ส่งแล้ว แต่ไม่มีการจ่ายสำเร็จ"); }, field: 'settled_without_payment', tone: 'warn' },
];
const PAYMENT_TONE = (p: string | null | undefined) => (!p ? 'muted' : /success|paid|complete/i.test(p) ? 'ok' : /fail|cancel|expire/i.test(p) ? 'danger' : /credit/i.test(p) ? 'info' : 'warn');
const ORDER_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'muted'> = { payment_pending: 'warn', paid: 'ok', preparing: 'info', shipped: 'info', delivered: 'ok', cancelled: 'muted', refunded: 'danger' };
const SYNC_DOT: Record<string, 'ok' | 'warn' | 'danger' | 'muted'> = { sent: 'ok', confirmed: 'ok', reserved: 'ok', skipped: 'muted', pending: 'warn', failed: 'danger' };

const CSV_COLUMNS = ['order_number', 'create_date', 'company_name', 'branch_name', 'customer_code', 'total_price', 'status', 'payment_status', 'jagota_sync_status', 'doc_book', 'doc_no'].map((key) => ({ key }));
const csv = (rows: JoshRow[]) => downloadCsv(rows, CSV_COLUMNS, `josh-orders-${new Date().toISOString().slice(0, 10)}.csv`);

export function JoshOrdersPage() {
  __useUiLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [salesUserId, setSalesUserId] = useState(['admin', 'sales_manager'].includes(session.claims()?.role ?? '') ? searchParams.get('salesUserId') ?? '' : '');
  const empty = { search: '', status: '', from: '', to: '' };
  const [draft, setDraft] = useState(empty);
  const [f, setF] = useState({ ...empty, sync: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIMIT);
  const summary = useAsync(() => joshOrderApi.summary({ ...f, sync: undefined, salesUserId: salesUserId || undefined }), [f.search, f.status, f.from, f.to, salesUserId]);
  const list = useAsync(() => joshOrderApi.list({ ...f, ...(f.sync === 'payment_missing' ? { sync: '', payment: 'missing' } : {}), page, limit: pageSize, salesUserId: salesUserId || undefined }), [f, page, pageSize, salesUserId]);
  const s = summary.data;

  const apply = (next: Partial<typeof f>) => { setPage(1); setF({ ...f, ...next }); };
  const chips = [
    f.sync && { label: `Jagota: ${SYNC_TILES.find((t) => t.key === f.sync)?.label ?? f.sync}`, clear: () => apply({ sync: '' }) },
    f.status && { label: `สถานะ: ${ORDER_STATUS[f.status] ?? f.status}`, clear: () => { setDraft({ ...draft, status: '' }); apply({ status: '' }); } },
    f.search && { label: `ค้นหา: ${f.search}`, clear: () => { setDraft({ ...draft, search: '' }); apply({ search: '' }); } },
    (f.from || f.to) && { label: `ช่วงเวลา: ${f.from || '…'} – ${f.to || '…'}`, clear: () => { setDraft({ ...draft, from: '', to: '' }); apply({ from: '', to: '' }); } },
  ].filter(Boolean) as { label: string; clear: () => void }[];

  return (
    <Page>
      <SalesRepFilter value={salesUserId} onChange={id => { setPage(1); setSalesUserId(id); }} />
      <PageHeader
        title={__uiText(session.claims()?.role === 'sale' ? "ออเดอร์ของฉัน" : "Orders (josh)")}
        badge={<TitleBadge icon="visibility">{__uiText("อ่านอย่างเดียว · ข้อมูลจาก josh")}</TitleBadge>}
        subtitle={__uiText("ออเดอร์หน้าร้าน · ส่งถึง Jagota (ERP) แล้วหรือยัง")}
        actions={
          <>
            <Button icon="download" disabled={!list.data?.items.length} onClick={() => list.data && csv(list.data.items)}>{__uiText("Export CSV")}</Button>
            <Button icon="refresh" onClick={() => { summary.reload(); list.reload(); }}>{__uiText("Refresh")}</Button>
          </>
        }
      />

      <ErrorText error={summary.error || list.error} />

      {s && (
        <StatGrid cols={5}>
          {SYNC_TILES.map((t) => {
            const n = Number(s[t.field] ?? 0);
            return (
              <StatTile
                key={t.key}
                label={t.label}
                value={fmt.num(n)}
                tone={n > 0 && t.tone !== 'ok' ? t.tone : undefined}
                icon={t.tone === 'ok' ? 'task_alt' : n > 0 ? (t.tone === 'danger' ? 'error' : 'hourglass_top') : 'check_circle'}
                selected={f.sync === t.key}
                onClick={() => apply({ sync: f.sync === t.key ? '' : t.key })}
              />
            );
          })}
        </StatGrid>
      )}

      <Panel as="form" className="p-3 space-y-3" onSubmit={(e) => { e.preventDefault(); apply({ search: draft.search, from: draft.from, to: draft.to }); }}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
          <SearchInput
            className="md:col-span-5"
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            placeholder={__uiText("ค้นหาเลข order / รหัสลูกค้า / PO / บริษัท…")}
            aria-label={__uiText("ค้นหา")}
          />
          <label className="md:col-span-2 flex items-center gap-1.5">
            <Icon name="calendar_today" size={15} className="text-outline shrink-0" />
            <Input type="date" aria-label={__uiText("ตั้งแต่")} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label className="md:col-span-2 flex items-center gap-1.5">
            <span className="text-outline text-xs">–</span>
            <Input type="date" aria-label={__uiText("ถึงก่อน")} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <div className="md:col-span-3 flex items-center justify-end gap-2">
            <Button type="submit" variant="primary" icon="search">{__uiText("ค้นหา")}</Button>
            <Button variant="ghost" onClick={() => { setDraft(empty); setPage(1); setF({ ...empty, sync: '' }); }}>{__uiText("ล้างตัวกรอง")}</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Segmented
            value={f.status}
            onChange={(v) => { setDraft({ ...draft, status: v }); apply({ status: v }); }}
            options={[{ value: '', label: __uiText("ทั้งหมด") }, ...Object.entries(ORDER_STATUS).map(([k, v]) => ({ value: k, label: v }))]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-secondary-container text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-on-surface-variant">{__uiText("ตัวกรองปัจจุบัน:")}</span>
            {chips.length ? chips.map((c) => <FilterChip key={c.label} onRemove={c.clear}>{c.label}</FilterChip>) : <span className="text-outline">{__uiText("ไม่มี")}</span>}
          </div>
          {list.data && (
            <div className="text-on-surface-variant font-mono">
              {__uiText("พบ ")}<span className="font-bold text-on-surface tabular-nums">{fmt.num(list.data.total)}</span> {__uiText(" รายการ")}{s && <span className="ml-2 font-sans">{__uiText("· มูลค่าที่ชำระแล้ว ")}{fmt.baht(s.paid_value)}</span>}
            </div>
          )}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        {list.loading && !list.data ? (
          <Loading />
        ) : list.data && list.data.items.length === 0 ? (
          <Empty icon="receipt_long">{__uiText("ไม่พบออเดอร์ตามตัวกรองนี้")}</Empty>
        ) : list.data ? (
          <>
            <Table maxHeight="calc(100vh - 330px)">
              <THead>
                <TH className="min-w-[150px]">{__uiText("Order No.")}</TH>
                <TH className="min-w-[130px]">{__uiText("วันที่")}</TH>
                <TH className="min-w-[240px]">{__uiText("บริษัท / สาขา")}</TH>
                <TH right className="min-w-[110px]">{__uiText("ยอดรวม ฿")}</TH>
                <TH>{__uiText("การชำระเงิน")}</TH>
                <TH>{__uiText("สถานะออเดอร์")}</TH>
                <TH className="min-w-[170px]">{__uiText("Jagota (ERP)")}</TH>
                <TH />
              </THead>
              <TBody>
                {list.data.items.map((o) => (
                  <TR key={o.orders_id} onClick={() => navigate(`/reports/orders/${o.orders_id}`, { state: { from: '/reports/orders', search: `?${searchParams.toString()}` } })}>
                    <TD><RowLink to={`/reports/orders/${o.orders_id}`} state={{ from: '/reports/orders', search: `?${searchParams.toString()}` }}>{o.order_number}</RowLink></TD>
                    <TD kind="time">{fmt.when(o.create_date)}</TD>
                    <TD><Stack2 top={o.company_name ?? '—'} bottom={[o.branch_name, o.customer_code].filter(Boolean).join(' · ')} /></TD>
                    <TD kind="money">{fmt.baht(o.total_price)}</TD>
                    <TD><Chip tone={PAYMENT_TONE(o.payment_status)}>{o.payment_status ?? __uiText("ไม่มีการจ่าย")}</Chip></TD>
                    <TD><Chip tone={ORDER_TONE[o.status] ?? 'muted'}>{ORDER_STATUS[o.status] ?? o.status}</Chip></TD>
                    <TD>
                      <StatusDot tone={o.jagota_sync_status ? SYNC_DOT[o.jagota_sync_status] ?? 'muted' : 'muted'}>
                        {o.jagota_sync_status ? SYNC[o.jagota_sync_status]?.[0] ?? o.jagota_sync_status : __uiText("ยังไม่ส่ง")}
                        {o.doc_no && <span className="font-mono text-on-surface-variant">{o.doc_book}{o.doc_no}</span>}
                      </StatusDot>
                      {o.jagota_error && <div className="text-[10px] text-[#c2333f] truncate max-w-[220px]" title={o.jagota_error}>{o.jagota_error}</div>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={(n) => { setPage(1); setPageSize(n); }} sizes={[20, 50, 100, 200]} />
          </>
        ) : null}
      </Panel>
    </Page>
  );
}

const KYC: Record<string, [string, string]> = { none: ['ไม่มีเอกสาร', 'muted'], pending: ['รอตรวจ', 'warn'], approved: ['ผ่าน', 'ok'], rejected: ['ไม่ผ่าน', 'danger'] };

/** josh business customers, read-only and masked like josh winback. */
export function JoshCustomersPage() {
  __useUiLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [salesUserId, setSalesUserId] = useState(['admin', 'sales_manager'].includes(session.claims()?.role ?? '') ? searchParams.get('salesUserId') ?? '' : '');
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ search: '', issue: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIMIT);
  const summary = useAsync(() => joshCustomerApi.summary(salesUserId || undefined), [salesUserId]);
  const list = useAsync(() => joshCustomerApi.list({ ...f, page, limit: pageSize, salesUserId: salesUserId || undefined }), [f, page, pageSize, salesUserId]);
  const s = summary.data;

  return (
    <Page>
      <SalesRepFilter value={salesUserId} onChange={id => { setPage(1); setSalesUserId(id); }} />
      <PageHeader
        title={__uiText(session.claims()?.role === 'sale' ? "ลูกค้าของฉัน" : "ลูกค้า / บริษัท (josh)")}
        subtitle={__uiText(session.claims()?.role === 'sale' ? "บริษัทและข้อมูลติดต่อของลูกค้าที่ฉันดูแล" : "บริษัท สาขา วงเงิน และ KYC · ข้อมูลส่วนบุคคลถูกปิดบังแบบเดียวกับ josh · ดูอย่างเดียว")}
        actions={<Button icon="refresh" onClick={() => { summary.reload(); list.reload(); }}>{__uiText("Refresh")}</Button>}
      />
      <div className="border-t border-secondary-container" />

      <ErrorText error={summary.error || list.error} />

      {s && (
        <div>
          <SectionTitle note={__uiText("Click to filter; click again to clear")}>{__uiText("Issues")}</SectionTitle>
          <StatGrid cols={3}>
            <StatTile
              accent
              tone={s.kyc_pending > 0 ? 'warn' : 'ok'}
              icon={s.kyc_pending > 0 ? 'hourglass_top' : 'check_circle'}
              label={__uiText("KYC รอตรวจ")}
              value={fmt.num(s.kyc_pending)}
              selected={f.issue === 'kyc_pending'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'kyc_pending' ? '' : 'kyc_pending' }); }}
            />
            <StatTile
              tone="info"
              icon="info"
              label={__uiText("ยังไม่ส่ง KYC")}
              value={fmt.num(s.kyc_none)}
              selected={f.issue === 'kyc_none'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'kyc_none' ? '' : 'kyc_none' }); }}
            />
            <StatTile
              accent
              tone={s.credit_application_pending > 0 ? 'warn' : 'ok'}
              icon={s.credit_application_pending > 0 ? 'hourglass_top' : 'check_circle'}
              label={__uiText("ขอวงเงินค้าง")}
              value={fmt.num(s.credit_application_pending)}
              selected={f.issue === 'credit_application_pending'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'credit_application_pending' ? '' : 'credit_application_pending' }); }}
            />
            <StatTile
              accent
              tone={s.over_credit > 0 ? 'danger' : 'ok'}
              icon={s.over_credit > 0 ? 'error' : 'check_circle'}
              label={__uiText("เกินวงเงิน")}
              value={fmt.num(s.over_credit)}
              selected={f.issue === 'over_credit'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'over_credit' ? '' : 'over_credit' }); }}
            />
            <StatTile
              tone="warn"
              icon="warning"
              label={__uiText("ใกล้เต็มวงเงิน (≥90%)")}
              value={fmt.num(s.near_credit)}
              selected={f.issue === 'near_credit'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'near_credit' ? '' : 'near_credit' }); }}
            />
            <StatTile
              accent
              tone={s.no_erp_code > 0 ? 'danger' : 'ok'}
              icon={s.no_erp_code > 0 ? 'error' : 'check_circle'}
              label={__uiText("ไม่มีรหัสลูกค้า ERP")}
              value={fmt.num(s.no_erp_code)}
              selected={f.issue === 'no_erp_code'}
              onClick={() => { setPage(1); setF({ ...f, issue: f.issue === 'no_erp_code' ? '' : 'no_erp_code' }); }}
            />
          </StatGrid>
          <div className="px-4 py-2 text-xs text-on-surface-variant">
            {s.total} {__uiText(" บริษัท · ใช้วงเงินรวม ")}{fmt.baht(s.credit_used_total)} / {fmt.baht(s.credit_limit_total)}
          </div>
        </div>
      )}

      <Panel className="overflow-hidden">
        <form className="p-4 flex gap-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setF({ ...f, search: search.trim() }); }}>
          <Input
            className="flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={__uiText("ชื่อบริษัท หรือรหัสลูกค้า ERP")}
          />
          <Button type="submit">{__uiText("ค้นหา")}</Button>
        </form>
      </Panel>

      {list.loading && !list.data ? (
        <Loading />
      ) : list.data ? (
        <>
          <Panel className="overflow-hidden">
            <Table>
              <THead>
                  <TH>{__uiText("บริษัท")}</TH>
                  <TH>{__uiText("รหัส ERP")}</TH>
                  <TH>{__uiText("วงเงิน")}</TH>
                  <TH>{__uiText("เครดิต")}</TH>
                  <TH>{__uiText("สาขา / คน")}</TH>
                  <TH>{__uiText("KYC")}</TH>
                  <TH>{__uiText("สั่งล่าสุด")}</TH>
                </THead>
              <TBody>
                {list.data.items.map((c) => {
                  const over = c.credit_limit > 0 && c.credit_used > c.credit_limit;
                  const [kl, kc] = KYC[c.kyc_status] ?? [c.kyc_status, 'muted'];
                  return (
                    <TR key={c.id} onClick={() => navigate(`/reports/customers/${c.id}`, { state: { from: '/reports/customers', search: `?${searchParams.toString()}` } })}>
                      <TD>
                        <RowLink mono={false} to={`/reports/customers/${c.id}`} state={{ from: '/reports/customers', search: `?${searchParams.toString()}` }}>{c.name}</RowLink>
                        <div className="font-mono text-[11px] text-on-surface-variant">{c.register_number}</div>
                      </TD>
                      <TD kind="code">{c.erp_customer_code ?? <Chip tone="warn">{__uiText("ไม่มี")}</Chip>}</TD>
                      <TD kind="money">
                        {fmt.baht(c.credit_used)} / {fmt.baht(c.credit_limit)}
                        {over && <div className="mt-1"><Chip tone="danger">{__uiText("เกินวงเงิน")}</Chip></div>}
                      </TD>
                      <TD>{c.credit_term_days ? __uiText("{0} วัน", {"0": c.credit_term_days}) : __uiText("เงินสด")}</TD>
                      <TD>{c.branch_count} / {c.user_count}</TD>
                      <TD><Chip tone={kc as any}>{kl}</Chip></TD>
                      <TD>{fmt.when(c.last_order_at)}</TD>
                    </TR>
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
  __useUiLocale();
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
        title={__uiText("ราคาที่ลูกค้าเห็น (josh)")}
        subtitle={__uiText("เลือกสาขา → ราคาต่อหน่วยที่ josh คิดวันนี้ ทีละชั้นตามลำดับของ josh และ quotation จาก ERP · ดูอย่างเดียว")}
        actions={<Button icon="refresh" onClick={() => { branches.reload(); prices.reload(); quotes.reload(); }}>{__uiText("Refresh")}</Button>}
      />
      <div className="border-t border-secondary-container" />

      <Panel>
        <form className="space-y-3 p-4">
          <Field label={__uiText("ค้นหา")}>
            <Input
              value={branchSearch}
              onChange={(e) => setBranchSearch(e.target.value)}
              placeholder={__uiText("ค้นหาบริษัท / สาขา / รหัสลูกค้า ERP")}
            />
          </Field>
          <Button type="button" onClick={() => setBq(branchSearch.trim())}>{__uiText("ค้นหาสาขา")}</Button>
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
              <Field label={__uiText("SKU")}>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder={__uiText("ว่าง = เฉพาะสินค้าที่มีราคาเฉพาะลูกค้า · หรือพิมพ์ SKU / ชื่อเพื่อดูสินค้าใดก็ได้")}
                />
              </Field>
              <Button type="button" variant="ghost" onClick={() => setSkuQ(sku.trim())}>{__uiText("แสดง")}</Button>
            </form>
            {prices.error && <ErrorText error={prices.error} />}
            {prices.loading && !prices.data ? (
              <Loading />
            ) : prices.data && prices.data.items.length ? (
              <Table>
                <THead>
                    <TH>{__uiText("SKU")}</TH>
                    <TH>{__uiText("สินค้า")}</TH>
                    <TH>{__uiText("ราคาปกติ")}</TH>
                    <TH>{__uiText("เฉพาะบริษัท")}</TH>
                    <TH>{__uiText("สัญญาสาขา")}</TH>
                    <TH>{__uiText("พิเศษสาขา")}</TH>
                    <TH>{__uiText("ขั้นบันได")}</TH>
                    <TH>{__uiText("วันนี้ลูกค้าจ่าย")}</TH>
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
                        <strong>{p.winner.price == null ? __uiText("คำนวณที่ josh") : fmt.baht(p.winner.price)}</strong>
                        <div className="text-[11px] text-on-surface-variant">{SOURCE[p.winner.source] ?? p.winner.source}</div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : prices.data ? (
              <Empty>{__uiText("ไม่มีราคาเฉพาะลูกค้าสำหรับสาขานี้ — พิมพ์ SKU เพื่อดูสินค้าอื่น")}</Empty>
            ) : null}
            {prices.data && <div className="px-4 py-3 text-xs text-on-surface-variant border-t border-secondary-container">{prices.data.note}</div>}
          </Panel>

          <Panel>
            <PanelHead title={__uiText("Quotation จาก ERP ({0})", {"0": branch.erp_customer_code ?? 'ไม่มีรหัสลูกค้า'})} />
            {quotes.loading && !quotes.data ? (
              <Loading />
            ) : quotes.data && quotes.data.length ? (
              <Table>
                <THead>
                    <TH>{__uiText("สินค้า")}</TH>
                    <TH>{__uiText("ราคา")}</TH>
                    <TH>{__uiText("หน่วย")}</TH>
                    <TH>{__uiText("ใช้ได้")}</TH>
                    <TH>{__uiText("สถานะ")}</TH>
                    <TH>{__uiText("เอกสาร")}</TH>
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
                      <TD><Chip tone={q.status === 'Y' ? 'ok' : 'muted'}>{q.status === 'Y' ? __uiText("ใช้งาน") : q.status === 'Z' ? __uiText("ยกเลิก") : q.status}</Chip></TD>
                      <TD kind="code">{q.doc_book}{q.doc_no}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : quotes.data ? (
              <Empty>{__uiText("ไม่มี quotation")}</Empty>
            ) : null}
          </Panel>
        </>
      )}
    </Page>
  );
}

