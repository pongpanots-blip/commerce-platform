import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Chip, Empty, ErrorText, Field, Input, Loading, PageHeader, Panel, PanelHead, Select, Table, TBody, TD, TH, THead, TR, useUiLocale, getUiLocale } from '@cp/ui';
import { getPaymentTransactionAnalytics, getPaymentTransactions, type PaymentTransactionItem, type PaymentTransactionAnalytics, type PaymentTransactionListParams } from '@josh/shared-api';
import { api, session } from '../../lib/api';
import { CommercePage } from '../CommercePage';
import { commerceText as text } from '../commerce-copy';
import { useAsync } from '../hooks';
import { TaskLinks, WorkspaceLink, WorkspaceMetric } from '../WorkspaceParts';

export const PAYMENT_LIST = '/j/payment-transactions';
const PAGE_SIZE = 20;
const statuses = ['pending', 'success', 'failed', 'cancelled'];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function parsePaymentRecord(value: unknown): PaymentTransactionItem {
  const row = record(value);
  if (typeof row.id !== 'string' || !row.id.trim() || typeof row.order_id !== 'string' || !row.order_id.trim() || typeof row.status !== 'string' || !statuses.includes(row.status) || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0 || typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) throw new Error('Invalid payment record.');
  for (const key of ['order_number', 'customer_name', 'payment_method', 'gateway_provider', 'gateway_charge_id', 'paid_at', 'created_at']) if (row[key] != null && typeof row[key] !== 'string') throw new Error('Invalid payment record.');
  return { ...row, order_number: row.order_number ?? '', customer_name: row.customer_name ?? '', payment_method: row.payment_method ?? '', gateway_provider: row.gateway_provider ?? '', gateway_charge_id: row.gateway_charge_id ?? null, paid_at: row.paid_at ?? null, created_at: row.created_at ?? '' } as PaymentTransactionItem;
}
export function parsePaymentDetail(answer: unknown) {
  const body = record(answer);
  if (body.source !== 'josh_replica' || body.freshness !== 'unavailable' || typeof body.capturedAt !== 'string' || !Number.isFinite(Date.parse(body.capturedAt))) throw new Error('Payment detail source could not be verified.');
  return { row: parsePaymentRecord(body.record), capturedAt: body.capturedAt };
}
export function parsePaymentPage(answer: unknown) {
  const response = record(answer), envelope = record(response.data), payload = record(envelope.data), meta = record(payload.meta);
  if (response.status !== 200 || envelope.status !== true || !Array.isArray(payload.data) || !count(meta.total)) throw new Error('Payment records could not be verified.');
  const rows = payload.data.map(parsePaymentRecord);
  if (rows.length > (meta.total as number) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Inconsistent payment records.');
  return { rows, total: meta.total as number };
}
export function parsePaymentAnalytics(answer: unknown): PaymentTransactionAnalytics {
  const response = record(answer), data = record(response.data);
  if (response.status !== true || !['total', 'pending', 'success', 'failed', 'cancelled'].every(key => count(data[key])) || ['pending', 'success', 'failed', 'cancelled'].reduce((sum, key) => sum + (data[key] as number), 0) > (data.total as number)) throw new Error('Payment summary could not be verified.');
  return data as unknown as PaymentTransactionAnalytics;
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function paymentQuery(params: URLSearchParams): { query: PaymentTransactionListParams; error?: string } {
  const rawPage = params.get('page') ?? '1', status = params.get('status') ?? '', startDate = params.get('startDate') ?? '', endDate = params.get('endDate') ?? '';
  const query = { page: Number(rawPage), limit: PAGE_SIZE, status: status || undefined, paymentMethod: params.get('paymentMethod') || undefined, gatewayProvider: params.get('gatewayProvider') || undefined, startDate: startDate || undefined, endDate: endDate || undefined, search: params.get('search')?.trim() || undefined };
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(query.page) || query.page < 1 || query.page > 100000 || status && !statuses.includes(status)) return { query, error: 'Invalid page or attempt filter.' };
  if (startDate && !validDate(startDate) || endDate && !validDate(endDate) || startDate && endDate && startDate > endDate) return { query, error: 'Enter valid dates with the start on or before the end.' };
  return { query };
}
export function paymentMoney(amount: unknown, currency: unknown) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return '—';
  return new Intl.NumberFormat(getUiLocale() === 'th' ? 'th-TH' : 'en-GB', { style: 'currency', currency }).format(amount);
}
export function paymentReviewReason(row: PaymentTransactionItem) {
  return row.status === 'failed' ? text('พยายามชำระไม่สำเร็จ', 'Failed attempt') : row.status === 'pending' ? text('ยังรอผลการชำระ', 'Awaiting attempt result') : row.status === 'success' && (!row.paid_at || !Number.isFinite(Date.parse(row.paid_at))) ? text('ไม่มีเวลาชำระที่ยืนยัน', 'Paid timestamp unavailable') : null;
}
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(getUiLocale() === 'th' ? 'th-TH' : 'en-GB') : text('ยังไม่มีข้อมูล', 'Unavailable');
function AttemptBadge({ status }: { status: string }) {
  const labels: Record<string, [string, string]> = { pending: ['รอผลการชำระ', 'Pending attempt'], success: ['พยายามชำระสำเร็จ', 'Successful attempt'], failed: ['พยายามชำระไม่สำเร็จ', 'Failed attempt'], cancelled: ['ยกเลิกการพยายามชำระ', 'Cancelled attempt'] };
  return <Chip tone={status === 'success' ? 'ok' : status === 'failed' ? 'danger' : status === 'pending' ? 'warn' : 'muted'}>{text(...(labels[status] ?? ['ไม่ทราบสถานะ', 'Unknown status']))}</Chip>;
}
const unavailable = () => text('ยังไม่มีข้อมูลการรับเงินเข้าบัญชี ค่าธรรมเนียม หรือรายการคืนเงิน', 'Settlement, fee and refund records are unavailable.');

export default function PaymentWorkspace({ role = session.claims()?.role }: { role?: string }) {
  useUiLocale();
  if (role !== 'admin') return <CommercePage><PageHeader title={text('รายการชำระเงิน', 'Payment records')} /><Alert tone="danger">{text('เฉพาะผู้ดูแลระบบเท่านั้น', 'Administrator access required.')}</Alert></CommercePage>;
  return <PaymentRecords />;
}

function PaymentRecords() {
  const { transactionId } = useParams();
  const [params, setParams] = useSearchParams();
  const key = params.toString(), parsed = paymentQuery(params), query = parsed.query;
  const list = useAsync(async () => parsed.error || transactionId ? null : parsePaymentPage(await getPaymentTransactions(query)), [key, !!transactionId]);
  const detail = useAsync(async () => {
    if (!transactionId) return null;
    const value = parsePaymentDetail(await api.get(`/reports/payment-transactions/${encodeURIComponent(transactionId)}`));
    if (value.row.id !== transactionId) throw new Error('Payment detail identity mismatch.');
    return value;
  }, [transactionId]);
  const analytics = useAsync(async () => transactionId ? null : parsePaymentAnalytics(await getPaymentTransactionAnalytics()), [!!transactionId]);
  const row = detail.data?.row;
  const update = (name: string, value: string) => { const next = new URLSearchParams(params); value ? next.set(name, value) : next.delete(name); if (name !== 'page') next.delete('page'); setParams(next); };
  const back = `${PAYMENT_LIST}${key ? `?${key}` : ''}`;
  if (transactionId) return <CommercePage>
    <WorkspaceLink to={back}>{text('กลับไปรายการชำระเงิน', 'Back to payment records')}</WorkspaceLink>
    <PageHeader title={transactionId} subtitle={text('ตรวจหลักฐานของการพยายามชำระแต่ละรายการ', 'Inspect evidence for this individual payment attempt.')} actions={<Button onClick={detail.reload} disabled={detail.loading}>{text('โหลดอีกครั้ง', 'Refresh')}</Button>} />
    <ErrorText error={detail.error} onRetry={detail.reload} />
    {detail.loading && !detail.data ? <Loading variant="detail" /> : row ? <><Alert tone="muted">{text('แหล่งข้อมูล: สำเนาสำหรับอ่าน · ไม่ทราบความสดของข้อมูล · เวลาอ่าน', 'Source: read replica · freshness unavailable · read captured')} {time(detail.data?.capturedAt)}</Alert><PaymentDetail row={row} /></> : !detail.error && <Empty>{text('ยังไม่มีรายการนี้ในสำเนาที่อ่านได้ กลับไปค้นหาในรายการ', 'This record is unavailable in the readable replica. Return to the list to search.')}</Empty>}
  </CommercePage>;
  const a = analytics.error ? null : analytics.data;
  return <CommercePage>
    <PageHeader title={text('รายการชำระเงิน', 'Payment records')} subtitle={text('แยกการพยายามชำระจากการรับเงินเข้าบัญชี เก็บรายการที่ล้มเหลวและพยายามซ้ำไว้', 'Keep attempts separate from settlement, including failed and repeated attempts.')} actions={<Button onClick={() => { list.reload(); analytics.reload(); }} disabled={list.loading || analytics.loading}>{text('โหลดอีกครั้ง', 'Refresh')}</Button>} />
    <ErrorText error={analytics.error} onRetry={analytics.reload} />
    {analytics.loading && !analytics.data ? <Loading variant="detail" /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <WorkspaceMetric label={text('การพยายามชำระทั้งหมด', 'All payment attempts')} value={a?.total} reason={text('ยังยืนยันสรุปรายการไม่ได้', 'Summary not verified.')} note={text('สรุปทุกขอบเขต ไม่เปลี่ยนตามตัวกรองตาราง', 'All-source summary; independent of table filters.')} />
      <WorkspaceMetric label={text('รับเงินเข้าบัญชี', 'Settlement')} reason={unavailable()} />
      <WorkspaceMetric label={text('รายการคืนเงิน', 'Refund records')} reason={unavailable()} />
      <WorkspaceMetric label={text('การพยายามชำระที่ควรตรวจ', 'Attempt review candidates')} value={a ? a.failed + a.pending : undefined} reason={text('ยังยืนยันสรุปรายการไม่ได้', 'Summary not verified.')} note={text('ผลรวมสถานะรอผลและล้มเหลว ไม่ใช่คิวที่มอบหมายแล้ว', 'Pending plus failed statuses; not an assigned investigation queue.')} />
    </div>}
    <Panel><PanelHead title={text('ค้นหาและตรวจรายการ', 'Find and inspect records')} />
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={text('สถานะการพยายามชำระ', 'Attempt state')}><Select value={params.get('status') ?? ''} onChange={event => update('status', event.target.value)}><option value="">{text('ทุกสถานะ', 'All attempts')}</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</Select></Field>
        <Field label={text('ช่องทาง', 'Channel')}><Select value={params.get('paymentMethod') ?? ''} onChange={event => update('paymentMethod', event.target.value)}><option value="">{text('ทุกช่องทาง', 'All channels')}</option>{['qr', 'credit', 'customer_credit', 'cod'].map(value => <option key={value}>{value}</option>)}</Select></Field>
        <Field label={text('ผู้ให้บริการ', 'Provider')}><Select value={params.get('gatewayProvider') ?? ''} onChange={event => update('gatewayProvider', event.target.value)}><option value="">{text('ทุกรายการ', 'All providers')}</option>{['omise', 'stripe', 'credit_terms', 'cod'].map(value => <option key={value}>{value}</option>)}</Select></Field>
        <Field label={text('รับเงินเข้าบัญชี / คิวตรวจ', 'Settlement / review queue')}><Select disabled aria-describedby="payment-unavailable-filters"><option>{text('ยังไม่มีข้อมูลตัวกรองนี้', 'Filter unavailable')}</option></Select></Field>
        <Field label={text('วันที่เริ่มต้นของแหล่งข้อมูล', 'Source start date')}><Input type="date" value={params.get('startDate') ?? ''} onChange={event => update('startDate', event.target.value)} /></Field>
        <Field label={text('วันที่สิ้นสุดของแหล่งข้อมูล', 'Source end date')}><Input type="date" value={params.get('endDate') ?? ''} onChange={event => update('endDate', event.target.value)} /></Field>
        <Field label={text('ค้นหาออเดอร์ / ข้อมูลอ้างอิง', 'Find order / reference')}><Input type="search" value={params.get('search') ?? ''} onChange={event => update('search', event.target.value)} /></Field>
        <Button variant="secondary" onClick={() => setParams({})}>{text('ล้างตัวกรอง', 'Clear filters')}</Button>
      </div>
      <p id="payment-unavailable-filters" className="px-4 pb-4 text-xs text-on-surface-variant">{unavailable()}</p>
      {parsed.error && <Alert tone="danger">{parsed.error}</Alert>}<ErrorText error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Loading variant="table" /> : list.data ? <>
        {list.loading && <p role="status" className="p-4 text-sm">{text('กำลังอัปเดต รายการด้านล่างเป็นผลลัพธ์ก่อนหน้า', 'Refreshing; the records below are the previous response.')}</p>}
        {list.data.rows.length ? <Table><THead><TH>{text('ข้อควรตรวจ', 'Exception')}</TH><TH>{text('รหัสรายการ', 'Transaction')}</TH><TH>{text('ออเดอร์ / ใบแจ้งหนี้', 'Order / invoice')}</TH><TH>{text('การพยายามชำระ / ประวัติ', 'Attempt / history')}</TH><TH>{text('ผู้ให้บริการ / ช่องทาง / อ้างอิง', 'Provider / channel / reference')}</TH><TH>{text('ยอดรวม', 'Gross')}</TH><TH>{text('ค่าธรรมเนียม / ยอดรับสุทธิ', 'Fees / net')}</TH><TH>{text('รับเงินเข้าบัญชี', 'Settlement')}</TH></THead><TBody>{list.data.rows.map(item => <TR key={item.id}><TD>{paymentReviewReason(item) ?? '—'}</TD><TD><WorkspaceLink to={`${PAYMENT_LIST}/${encodeURIComponent(item.id)}${key ? `?${key}` : ''}`}>{item.id}</WorkspaceLink></TD><TD><WorkspaceLink to={`/j/order/${encodeURIComponent(item.order_id)}`}>{item.order_number || item.order_id}</WorkspaceLink><p className="mt-1 text-xs">{text('ใบแจ้งหนี้: ยังไม่มีข้อมูล', 'Invoice: unavailable')}</p></TD><TD><AttemptBadge status={item.status} /><p className="mt-1 text-xs">{time(item.created_at)}</p><p className="text-xs text-on-surface-variant">{text('ไม่มีประวัติการเปลี่ยนสถานะ', 'State history unavailable')}</p></TD><TD>{item.gateway_provider || '—'} / {item.payment_method || '—'}<p className="text-xs break-all">{item.gateway_charge_id ?? '—'}</p></TD><TD>{paymentMoney(item.amount, item.currency)}</TD><TD>—<p className="text-xs">{text('ยังไม่มีข้อมูล', 'Unavailable')}</p></TD><TD><Chip tone="muted">{text('ยังไม่มีข้อมูล', 'Unavailable')}</Chip></TD></TR>)}</TBody></Table> : <Empty>{text('ไม่มีรายการตรงกับตัวกรอง ลองล้างตัวกรองเพื่อค้นหาอีกครั้ง', 'No records match these filters. Clear filters to search again.')}</Empty>}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm" aria-live="polite">{text('หน้า', 'Page')} {query.page} / {Math.max(1, Math.ceil(list.data.total / PAGE_SIZE))} · {list.data.total} {text('รายการในขอบเขตนี้', 'records in this scope')}</p><div className="flex gap-2"><Button variant="secondary" disabled={list.loading || query.page! <= 1} onClick={() => update('page', String(query.page! - 1))}>{text('ก่อนหน้า', 'Previous')}</Button><Button variant="secondary" disabled={list.loading || query.page! * PAGE_SIZE >= list.data.total} onClick={() => update('page', String(query.page! + 1))}>{text('ถัดไป', 'Next')}</Button></div></div>
      </> : null}
    </Panel>
    <Alert tone="muted">{text('การชำระสำเร็จไม่ได้ยืนยันการรับเงินเข้าบัญชี หน้านี้ไม่มีการคืนเงิน ยกเลิก หรือสั่งจ่าย', 'A successful attempt does not prove settlement. This page has no refund, void or payout actions.')}</Alert>
  </CommercePage>;
}

function PaymentDetail({ row }: { row: PaymentTransactionItem }) {
  return <>
    <div className="flex flex-wrap gap-2"><AttemptBadge status={row.status} /><Chip tone="muted">{text('รับเงินเข้าบัญชี: ยังไม่มีข้อมูล', 'Settlement: unavailable')}</Chip></div>
    <div className="commerce-inspector-grid"><div className="space-y-4 min-w-0">
      <TaskLinks title={text('ข้อมูลที่เกี่ยวข้อง', 'Related identifiers')}><WorkspaceLink to={`/j/order/${encodeURIComponent(row.order_id)}`}>{row.order_number || row.order_id}</WorkspaceLink><dl className="grid gap-2 text-sm"><dt>{text('ลูกค้า', 'Customer')}</dt><dd>{row.customer_name || '—'}</dd><dt>{text('ผู้ให้บริการ / ช่องทาง', 'Provider / channel')}</dt><dd>{row.gateway_provider} / {row.payment_method}</dd><dt>{text('ข้อมูลอ้างอิงผู้ให้บริการ', 'Provider reference')}</dt><dd className="break-all">{row.gateway_charge_id ?? text('ยังไม่มีข้อมูล', 'Unavailable')}</dd><dt>{text('ใบแจ้งหนี้', 'Invoice')}</dt><dd>{text('ยังไม่มีข้อมูล', 'Unavailable')}</dd></dl></TaskLinks>
      <TaskLinks title={text('เหตุการณ์ที่มีหลักฐาน', 'Available event evidence')}><ol className="space-y-3 text-sm"><li>{text('สร้างรายการ', 'Record created')} · {time(row.created_at)}</li><li>{text('เวลาชำระที่บันทึก', 'Recorded paid timestamp')} · {time(row.paid_at)}</li></ol><p className="text-xs text-on-surface-variant">{text('ไม่มีบันทึกประวัติสถานะทั้งหมด ไม่อนุมานลำดับการพยายามซ้ำ', 'Full state history is unavailable. Retry chronology is not inferred.')}</p></TaskLinks>
      <TaskLinks title={text('รับเงินเข้าบัญชีและข้อแตกต่าง', 'Settlement and discrepancies')}><Alert tone="muted">{unavailable()}</Alert><p className="text-sm">{text('ยังเปรียบเทียบยอดรับสุทธิกับยอดรวมไม่ได้ ไม่มีหลักฐานให้ระบุว่าตรงกันหรือไม่ตรงกัน', 'Net settlement cannot be compared with gross. There is no evidence to label it matched or mismatched.')}</p></TaskLinks>
    </div><div className="space-y-4 min-w-0"><WorkspaceMetric label={text('ยอดรวมของการพยายามชำระ', 'Gross attempt amount')} value={paymentMoney(row.amount, row.currency)} note={text('ยอดในรายการนี้ ไม่ใช่ยอดที่รับเข้าบัญชี', 'This attempt amount, not settled funds.')} /><TaskLinks title={text('รายละเอียดจำนวนเงิน', 'Amount breakdown')}><p>{text('ค่าธรรมเนียม: ยังไม่มีข้อมูล', 'Fees: unavailable')}</p><p>{text('ยอดรับสุทธิ: ยังไม่มีข้อมูล', 'Net settlement: unavailable')}</p><p>{text('คืนเงิน / ข้อพิพาท: ยังไม่มีข้อมูล', 'Refunds / disputes: unavailable')}</p></TaskLinks><TaskLinks title={text('แนวทางตรวจสอบ', 'Investigation checklist')}><ul className="list-disc pl-5 space-y-2 text-sm"><li>{text('ตรวจออเดอร์และข้อมูลอ้างอิงของผู้ให้บริการ', 'Inspect the order and provider reference.')}</li><li>{text('หาเอกสารรับเงินเข้าบัญชีที่ยืนยันได้', 'Obtain verified settlement evidence.')}</li><li>{text('ตรวจการพยายามซ้ำในหน้ารายการ อย่าลบรายการล้มเหลว', 'Review repeated attempts in the list; retain failures.')}</li></ul><p className="text-xs">{text('รายการตรวจนี้ไม่ถูกบันทึกเป็นสถานะที่ทำเสร็จ', 'This checklist does not persist a completed status.')}</p></TaskLinks></div></div>
  </>;
}
