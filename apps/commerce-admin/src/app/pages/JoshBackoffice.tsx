// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert, Button, Chip, Empty, ErrorText, Loading, Page, PageHeader, Panel, Pager, SearchInput, Segmented, TBody, TD, TH, THead, TR, Table,
  TitleBadge, fmt, statusLabel, toneOf,
} from '@cp/ui';
import { backofficeApi, BackofficeColumn } from '../../lib/api';
import { useAsync } from '../hooks';
import { ACTION_VIEWS, RowAction, ViewCreate } from './JoshBackofficeActions';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Thai page titles; the API's own title is the fallback for a view added later. */
const VIEW_TITLES: Record<string, string> = {
  get kyc() { return __uiText("เอกสารยืนยันตัวตนรอตรวจ"); },
  get credit_terms() { return __uiText("ขอเครดิต"); },
  get credit_notes() { return __uiText("ใบลดหนี้"); },
  get invoices() { return __uiText("ใบแจ้งหนี้"); },
  get credit_backs() { return __uiText("ยอดคืนเป็นเครดิต"); },
  get shipments() { return __uiText("การจัดส่ง"); },
  get payments() { return __uiText("รายการชำระเงิน"); },
  get coupons() { return __uiText("คูปอง"); },
  get campaigns() { return __uiText("แคมเปญ"); },
  get segments() { return __uiText("กลุ่มลูกค้า"); },
  get suppliers() { return __uiText("ผู้ขายสินค้า"); },
  get internal_docs() { return __uiText("เอกสารภายใน"); },
  get admin_access() { return __uiText("คำขอเข้าระบบหลังร้าน"); },
};

/** Column headers that the API sends in English or as codes; keyed by column key. */
const COLUMN_LABELS: Record<string, string> = {
  get id() { return __uiText("รหัส"); },
  get application_id() { return __uiText("รหัส"); },
  get supplier_id() { return __uiText("รหัส"); },
  get slug() { return __uiText("รหัสกลุ่ม"); },
  get erp_customer_code() { return __uiText("รหัสลูกค้า (ERP)"); },
  get erp_inv() { return __uiText("เลขใบแจ้งหนี้ (ERP)"); },
  get erp_sync_status() { return __uiText("ส่งเข้าระบบบัญชี (ERP)"); },
  get order_number() { return __uiText("เลขออเดอร์"); },
  get shipment_number() { return __uiText("เลขการจัดส่ง"); },
  get invoice_number() { return __uiText("เลขใบแจ้งหนี้"); },
  get cn_number() { return __uiText("เลขใบลดหนี้"); },
  get cb_number() { return __uiText("เลขยอดคืน"); },
  get order_amount() { return __uiText("ยอดออเดอร์"); },
  get invoice_amount() { return __uiText("ยอดใบแจ้งหนี้"); },
  get three_pl_status() { return __uiText("สถานะบริษัทขนส่ง"); },
  get gateway_charge_id() { return __uiText("รหัสรายการชำระ"); },
};

/** Display labels for status values the shared status list doesn't cover. Filter values stay the raw code. */
const VALUE_LABELS: Record<string, string> = {
  get open() { return __uiText("รอชำระ"); },
  get overdue() { return __uiText("เกินกำหนด"); },
  get upcoming() { return __uiText("ยังไม่เริ่ม"); },
  get running() { return __uiText("กำลังใช้งาน"); },
  get ended() { return __uiText("จบแล้ว"); },
  get backend() { return __uiText("ระบบหลังบ้าน"); },
  get webshop() { return __uiText("เว็บร้านค้า"); },
  get landing() { return __uiText("หน้าแนะนำร้าน"); },
  get api() { return __uiText("การเชื่อมต่อระบบ"); },
  get mobileapp() { return __uiText("แอปมือถือ"); },
  get PERCENTAGE() { return __uiText("เปอร์เซ็นต์ (%)"); },
  get FIXED_AMOUNT() { return __uiText("จำนวนเงินคงที่ (บาท)"); },
  get public() { return __uiText("แจกทุกคน"); },
  get assigned() { return __uiText("แจกเฉพาะคน"); },
  get unique_per_user() { return __uiText("โค้ดเฉพาะแต่ละคน"); },
};
const VALUE_TONES: Record<string, 'ok' | 'muted' | 'info'> = { running: 'ok', ended: 'muted', upcoming: 'info' };
const valueLabel = (v: string) => (Object.prototype.hasOwnProperty.call(VALUE_LABELS, v) ? VALUE_LABELS[v] : statusLabel(v));

/** Text columns that hold codes rather than words: shown through VALUE_LABELS, or mono when unknown. */
const CODE_COLUMNS = new Set(['coupon_type', 'distribution_type', 'discount_type', 'usage_type', 'rule_type', 'application_type', 'fulfillment_type', 'document_type', 'payment_method', 'gateway_provider', 'source', 'currency']);

const tdKind = (k: BackofficeColumn['kind']) => (k === 'money' ? 'money' : k === 'number' ? 'num' : k === 'datetime' || k === 'date' ? 'time' : 'text');

function cell(col: BackofficeColumn, v: unknown) {
  if (v === null || v === undefined || v === '') return <span className="text-on-surface-variant">—</span>;
  switch (col.kind) {
    case 'money': return money.format(Number(v));
    case 'number': return Number(v).toLocaleString('th-TH');
    case 'datetime': return fmt.when(String(v));
    case 'date': return String(v).slice(0, 10);
    case 'bool': return v ? <span className="text-ok">✓</span> : <span className="text-on-surface-variant">—</span>;
    case 'status':
      if (col.key === 'category') return <Chip>{valueLabel(String(v))}</Chip>;
      return <Chip tone={VALUE_TONES[String(v)] ?? toneOf(String(v))} statusCode={String(v)} dot>{valueLabel(String(v))}</Chip>;
    case 'code': return <span className="font-mono text-[11px] block max-w-[180px] truncate" title={String(v)}>{String(v)}</span>;
    default:
      if (!CODE_COLUMNS.has(col.key)) return String(v);
      return Object.prototype.hasOwnProperty.call(VALUE_LABELS, String(v))
        ? VALUE_LABELS[String(v)]
        : <span className="font-mono text-[11px]">{String(v)}</span>;
  }
}

/**
 * josh back-office lists, read-only from josh's replica (KYC, credit, CN/CB, shipments, payments,
 * coupons, campaigns, segments, suppliers, admin access). Columns come from the API, keyed by josh's
 * column names. Changes still happen in josh's web-admin.
 */
export function JoshBackoffice() {
  __useUiLocale();
  const { view = 'kyc' } = useParams();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  useEffect(() => { setSearch(''); setQ(''); setStatus(''); setPage(1); setMsg(''); }, [view]);
  const list = useAsync(() => backofficeApi.list(view, { search: q, status, page }), [view, q, status, page]);
  const d = list.data;

  return (
    <Page>
      <PageHeader
        title={(Object.prototype.hasOwnProperty.call(VIEW_TITLES, view) ? VIEW_TITLES[view] : d?.title) ?? '…'}
        badge={<TitleBadge icon={ACTION_VIEWS.has(view) ? 'touch_app' : 'visibility'}>{ACTION_VIEWS.has(view) ? __uiText("จัดการได้ตามสิทธิ์ของคุณในร้านค้า") : __uiText("อ่านอย่างเดียว · ข้อมูลสำรองของร้านค้า")}</TitleBadge>}
        subtitle={__uiText("งานแก้ไขอื่นยังทำที่ระบบหลังร้านของร้านค้า เบอร์ อีเมล และชื่อคนถูกปิดบังไว้")}
        actions={<Button icon="refresh" onClick={list.reload}>{__uiText("โหลดใหม่")}</Button>}
      />

      {msg && <Alert tone="ok" onClose={() => setMsg('')}>{(typeof msg === 'string' ? __uiText(msg) : msg)}</Alert>}
      <ErrorText error={list.error} />

      <ViewCreate key={view} view={view} onDone={(m) => { setMsg(m); list.reload(); }} />

      <Panel as="form" className="p-3 space-y-3" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput className="flex-1 min-w-60" placeholder={__uiText("ค้นหา…")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={__uiText("ค้นหา")} />
          <Button type="submit" variant="primary" icon="search">{__uiText("ค้นหา")}</Button>
          {(q || status) && <Button variant="ghost" onClick={() => { setSearch(''); setQ(''); setStatus(''); setPage(1); }}>{__uiText("ล้างตัวกรอง")}</Button>}
        </div>
        {d && !!d.byStatus.length && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="overflow-x-auto">
              <Segmented
                value={status}
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={[
                  { value: '', label: __uiText("ทั้งหมด"), count: d.byStatus.reduce((a, s) => a + s.n, 0) },
                  ...d.byStatus.filter((s) => s.status).map((s) => ({ value: s.status as string, label: valueLabel(s.status as string), count: s.n })),
                ]}
              />
            </div>
            <span className="text-xs text-on-surface-variant tabular-nums">{__uiText("พบ ")}<span className="font-semibold text-on-surface">{fmt.num(d.total)}</span> {__uiText(" รายการ")}</span>
          </div>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        {list.loading && !d ? (
          <Loading />
        ) : d && d.items.length ? (
          <>
            <Table maxHeight="calc(100vh - 330px)">
              <THead>
                {ACTION_VIEWS.has(view) && <TH>{__uiText("จัดการ")}</TH>}
                {d.columns.map((c) => <TH key={c.key} kind={tdKind(c.kind)}>{COLUMN_LABELS[c.key] ?? c.label}</TH>)}
              </THead>
              <TBody>
                {d.items.map((r, i) => (
                  <TR key={i}>
                    {ACTION_VIEWS.has(view) && (
                      <TD>
                        <RowAction view={view} row={r} onDone={(m) => { setMsg(m); list.reload(); }} />
                      </TD>
                    )}
                    {d.columns.map((c) => (
                      <TD key={c.key} kind={tdKind(c.kind)}>{cell(c, r[c.key])}</TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pager page={page} pageSize={d.limit} total={d.total} onPage={setPage} />
          </>
        ) : d ? (
          <Empty>{q || status ? __uiText("ไม่พบรายการตามตัวกรองนี้ ลองค้นหาคำอื่นหรือล้างตัวกรอง") : __uiText("ยังไม่มีรายการในหน้านี้ ข้อมูลจะขึ้นเมื่อร้านค้ามีรายการใหม่")}</Empty>
        ) : null}
      </Panel>
    </Page>
  );
}
