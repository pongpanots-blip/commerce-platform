// ui-metadata-migration: static labels and UI notices only
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert, Button, CodeBlock, DetailSection, Empty, ErrorText, Field, FormPanel, Hint, Input, KeyValueGrid, Loading, Page, PageHeader, Panel, PanelHead,
  SearchInput, Segmented, Select, StatusChip, TBody, TD, TH, THead, TR, Table, Textarea, Chip, EmptyState, useUnsavedChanges, TaskPanelForm, TaskInput, TaskSelect, TaskTextarea, toneOf, fmt,
} from '@cp/ui';
import { joshAdmin, joshCustomerApi, joshProductApi, JoshRow, session, joshOrderApi } from '../../lib/api';
import { useAsync, useMutation } from '../hooks';
import { InterruptedAction, requireSaved, taskMessages, useActionDraft, writeFailure } from '../task-forms';
import { isRouteAllowed } from '../../lib/landing';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Row = Record<string, unknown>;
/** Some upstream routes report a business failure in a successful HTTP response. */
function confirmedAnswer<T>(answer: T): T {
  if (answer && typeof answer === 'object') {
    const value = answer as Record<string, unknown>;
    if (value.status === false || value.success === false) throw new Error(String(value.message ?? 'Operation was not saved'));
  }
  return answer;
}
function receiptBody(answer: unknown): Row {
  let value = confirmedAnswer(answer);
  for (let i = 0; i < 2 && value && typeof value === 'object' && 'data' in value; i++) value = confirmedAnswer((value as Row).data);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
export function orderReceipt(answer: unknown): Row {
  const value = receiptBody(answer);
  return requireSaved(value, r => Array.isArray(r.orderIds) && r.orderIds.length > 0 && r.orderIds.every(id => typeof id === 'string' && !!id.trim()));
}
export function mergeReceipt(answer: unknown): Row {
  return requireSaved(receiptBody(answer), r => r.merged === true);
}
/** josh answers lists as an array, `{ data }`, `{ data: { items } }` or `{ items }`. */
function rowsOf(answer: unknown): Row[] {
  confirmedAnswer(answer);
  const a = answer as { data?: unknown; items?: unknown } | unknown[] | null;
  if (Array.isArray(a)) return a as Row[];
  const d = a?.data as { items?: unknown; data?: unknown } | unknown[] | undefined;
  if (Array.isArray(d)) return d as Row[];
  if (Array.isArray(d?.items)) return d.items as Row[];
  if (Array.isArray(d?.data)) return d.data as Row[];
  if (Array.isArray(a?.items)) return a.items as Row[];
  throw new Error('Invalid sample request response');
}

const PAYMENT = [['credit', 'เครดิตเทอม'], ['qr', 'QR'], ['cod', 'เก็บปลายทาง'], ['payment_link', 'ลิงก์ชำระเงิน'], ['customer_credit', 'เครดิตลูกค้า']];
const SAMPLE_STATUS: Record<string, string> = { pending: 'รอพิจารณา', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติแล้ว', fulfilled: 'ส่งแล้ว' };
const paymentLabel = (code: string) => __uiText(PAYMENT.find(([k]) => k === code)?.[1] ?? code);
const SAMPLE_DECISION: Record<string, string> = { approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', fulfilled: 'บันทึกการส่ง' };
const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
/** Backend rejects a CS search shorter than 2 characters. */
function readySearch(value: string) {
  const term = value.trim();
  return term.length >= 2 ? term : '';
}
const CS_TASKS = [
  { to: '/cs/orders/new', label: 'สั่งของแทนลูกค้า', description: 'เลือกลูกค้าและสินค้า ตรวจราคา แล้วสั่งซื้อ' },
  { to: '/cs/samples', label: 'คำขอสินค้าตัวอย่าง', description: 'ตรวจคำขอ อนุมัติ และบันทึกการส่งสินค้า' },
  { to: '/cs/accounts/merge', label: 'รวมบัญชีซ้ำ', description: 'ย้ายข้อมูลจากบัญชีซ้ำเข้าบัญชีหลัก' },
];

export function SampleRequestsRedirect({ role }: { role?: string }) {
  const { search, hash } = useLocation();
  return isRouteAllowed(role, '/j/cs/sample-requests')
    ? <Navigate to={`/cs/samples${search}${hash}`} replace />
    : <Alert tone="danger">{__uiText('คุณไม่มีสิทธิ์ทำงานนี้')}</Alert>;
}

/**
 * CS work that used to be in josh admin: order on behalf of a customer (josh quotes and places it
 * with its own checkout), sample requests, merging duplicate accounts. Everything runs as josh's own
 * CS-admin routes (josh COMMERCE_OWNS_CS_ORDERS / COMMERCE_OWNS_CUSTOMERS lock josh's own buttons).
 */
export function CsDesk({ role = session.claims()?.role }: { role?: string }) {
  __useUiLocale();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const task = CS_TASKS.find(item => pathname === item.to || pathname.startsWith(`${item.to}/`));
  if (!isRouteAllowed(role, pathname)) return <Page><PageHeader title={__uiText('งานบริการลูกค้า')} /><Alert tone="danger">{__uiText('คุณไม่มีสิทธิ์ทำงานนี้')}</Alert></Page>;
  if (pathname === '/cs') return <Navigate to={`/cs/orders/new${search}${hash}`} replace />;
  return <Page>
    <PageHeader title={__uiText("งานบริการลูกค้า")} subtitle={__uiText("สั่งของแทนลูกค้า ตรวจคำขอสินค้าตัวอย่าง และรวมบัญชีซ้ำ ระบบบันทึกอีเมลของคุณไว้ในประวัติทุกครั้ง")} />
    <div className="overflow-x-auto"><Segmented value={task?.to ?? ''} onChange={to => navigate(to)} options={CS_TASKS.filter(item => isRouteAllowed(role, item.to)).map(item => ({ value: item.to, label: __uiText(item.label) }))} /></div>
    {task?.to === '/cs/orders/new' && <OrderOnBehalf />}
    {task?.to === '/cs/samples' && <Samples key={pathname} />}
    {task?.to === '/cs/accounts/merge' && <Merge />}
  </Page>;
}

/** Company → one of its users and branches (from josh's replica). */
function CustomerPick({ onPick, initial }: { initial?: { company: JoshRow; userId: string; branchId: string } | null; onPick: (p: { company: JoshRow; userId: string; branchId: string } | null) => void }) {
  __useUiLocale();
  const [q, setQ] = useState(initial?.company.name ?? '');
  const [search, setSearch] = useState(initial?.company.name ?? '');
  const [companyId, setCompanyId] = useState(initial?.company.id ?? '');
  const [userId, setUserId] = useState(initial?.userId ?? '');
  const [branchId, setBranchId] = useState(initial?.branchId ?? '');
  const term = readySearch(search);
  const found = useAsync(() => (term ? joshCustomerApi.list({ search: term, page: 1, limit: 20 }) : Promise.resolve(null)), [term]);
  const detail = useAsync(() => (companyId ? joshCustomerApi.detail(companyId) : Promise.resolve(null)), [companyId]);
  const d = detail.data;
  useEffect(() => {
    if (d) onPick(d.users.some((u: JoshRow) => u.id === userId && u.is_active) && d.branches.some((b: JoshRow) => b.id === branchId) ? { company: d, userId, branchId } : null);
    else if (detail.error) onPick(null);
  }, [d, detail.error]);
  const pick = (u: string, b: string) => { setUserId(u); setBranchId(b); onPick(d && u && b ? { company: d, userId: u, branchId: b } : null); };
  return (
    <DetailSection title={__uiText("1 · ลูกค้า")} icon="business">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <SearchInput className="flex-1" aria-label={__uiText("ค้นหาบริษัท")} placeholder={__uiText("ชื่อบริษัท / รหัสลูกค้า ERP")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" icon="search">{__uiText("ค้นหา")}</Button>
      </form>
      {q.trim().length > 0 && q.trim().length < 2 && <Hint>{__uiText("พิมพ์อย่างน้อย 2 ตัวอักษร")}</Hint>}
      {found.loading && term && <Loading variant="form" />}
      <ErrorText error={found.error} onRetry={found.reload} />
      {detail.loading && companyId && <Loading variant="form" />}
      <ErrorText error={detail.error} onRetry={detail.reload} />
      {term && found.data && !found.data.items.length && <Empty icon="search_off">{__uiText("ไม่พบบริษัทที่ตรงกับคำค้น")}</Empty>}
      {!!found.data?.items.length && (
        <Field label={__uiText("บริษัท")}>
          <Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); pick('', ''); }}>
            <option value="">{__uiText("— เลือก —")}</option>
            {found.data.items.map((c) => <option key={c.id} value={c.id}>{c.name} {c.erp_customer_code ? `(${c.erp_customer_code})` : ''}</option>)}
          </Select>
        </Field>
      )}
      {d && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={__uiText("ผู้ใช้")}>
            <Select value={userId} onChange={(e) => pick(e.target.value, branchId)}>
              <option value="">{__uiText("— เลือก —")}</option>
              {d.users.filter((u: JoshRow) => u.is_active).map((u: JoshRow) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ''} · {u.role}</option>)}
            </Select>
          </Field>
          <Field label={__uiText("สาขาที่ส่ง")}>
            <Select value={branchId} onChange={(e) => pick(userId, e.target.value)}>
              <option value="">{__uiText("— เลือก —")}</option>
              {d.branches.map((b: JoshRow) => <option key={b.id} value={b.id}>{b.name}{b.is_default_delivery ? __uiText(" (หลัก)") : ''}</option>)}
            </Select>
          </Field>
          <Hint className="md:col-span-2">{__uiText("วงเงิน ")}{fmt.baht(d.credit_limit)} {__uiText(" · ใช้ไป ")}{fmt.baht(d.credit_used)} {__uiText(" · เครดิต ")}{show(d.credit_term_days)} {__uiText(" วัน")}</Hint>
        </div>
      )}
    </DetailSection>
  );
}

function OrderOnBehalf() {
  __useUiLocale();
  const draft = useActionDraft('cs:order', { who: '', items: '[]', payment_method: 'credit', coupon_code: '', delivery_date: '' });
  const [who, setWho] = useState<{ company: JoshRow; userId: string; branchId: string } | null>(() => {
    try { const value = JSON.parse(draft.values.who); return value?.company?.id && value.userId && value.branchId ? value : null; } catch { return null; }
  });
  const initialWho = useState(who)[0];
  const [items, setItems] = useState<{ id: string; sku: string; name: string; quantity: number }[]>(() => {
    try { const value = JSON.parse(draft.values.items); return Array.isArray(value) ? value.filter(item => item?.id && Number.isInteger(item.quantity) && item.quantity > 0) : []; } catch { return []; }
  });
  const [skuQ, setSkuQ] = useState('');
  const [skuSearch, setSkuSearch] = useState('');
  const [quote, setQuote] = useState<unknown>(null);
  const [pay, setPay] = useState({ payment_method: draft.values.payment_method, coupon_code: draft.values.coupon_code, delivery_date: draft.values.delivery_date });
  useEffect(() => { draft.set(current => ({ ...current, ...pay, who: who ? JSON.stringify({ company: { id: who.company.id, name: who.company.name }, userId: who.userId, branchId: who.branchId }) : '', items: JSON.stringify(items) })); }, [who, items, pay]);
  const mutation = useMutation();
  const busy = mutation.busy || draft.pending || draft.outstanding;
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const skuTerm = readySearch(skuSearch);
  useUnsavedChanges(items.length > 0 || busy);
  const products = useAsync(() => (skuTerm ? joshProductApi.list({ search: skuTerm, status: 'active', page: 1, limit: 10 }) : Promise.resolve(null)), [skuTerm]);
  const body = () => ({ user_id: who!.userId, branch_id: who!.branchId, items: items.map((i) => ({ product_inventory_id: i.id, quantity: i.quantity })) });

  async function run(fn: () => Promise<unknown>, after: (r: unknown) => void) {
    if (busy) return false;
    setMsg(null);
    const result = await mutation.run(() => fn().then(answer => requireSaved(receiptBody(answer), r => Number.isFinite(Number(r.total_inc_vat ?? r.total)) && (r.total_inc_vat != null || r.total != null))));
    if (result.ok) after(result.value);
    return result.ok;
  }
  const getQuote = () => { if (!busy && who && items.length) { setQuote(null); return run(() => joshAdmin.call('POST', '/cs-admin/orders/quote', body()), (r) => setQuote(r)); } };
  async function place(_data: FormData, signal: AbortSignal) {
    if (busy || !who || !items.length || quote == null || draft.interrupted) return { ok: false as const, formError: __uiText('ตรวจข้อมูลก่อนบันทึก') };
    if (!window.confirm(__uiText('สั่ง {0} รายการให้ {1} ({2})?\n\njosh จะสร้าง order จริงและส่งเข้า ERP ตามปกติ', { 0: items.length, 1: who.company.name, 2: paymentLabel(pay.payment_method) }))) return { ok: false as const, formError: __uiText('ยกเลิกการบันทึกแล้ว') };
    if (!draft.begin(signal)) return { ok: false as const, formError: __uiText('ยังยืนยันผลการบันทึกไม่ได้') };
    try {
      return { ok: true as const, receipt: orderReceipt(await joshAdmin.call('POST', '/cs-admin/orders/place-on-behalf', { ...body(), payment_method: pay.payment_method, ...(pay.coupon_code.trim() ? { coupon_code: pay.coupon_code.trim() } : {}), ...(pay.delivery_date ? { delivery_date: pay.delivery_date } : {}) })) };
    } catch (error) { if (!signal.aborted) draft.fail(error); return writeFailure(error); }
    finally { draft.settle(); }
  }
  async function checkOrders() {
    const latest = await joshOrderApi.list({ search: who?.company.name ?? '', page: 1, limit: 20 });
    if (!Array.isArray(latest.items)) throw new Error(__uiText('ยังยืนยันผลการบันทึกไม่ได้'));
    return __uiText('พบออเดอร์ {0} รายการในผลค้นหาล่าสุด ตรวจออเดอร์และหน้าถัดไปก่อนลองใหม่', { 0: latest.total });
  }
  const changeItems = (next: typeof items) => { setItems(next); setQuote(null); };

  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <ErrorText error={mutation.error} />
      {draft.recovered && !draft.interrupted && <Hint>{__uiText('กู้คืนข้อมูลที่ยังไม่บันทึกแล้ว ตรวจข้อมูลก่อนบันทึก')}</Hint>}
      {draft.interrupted && <InterruptedAction outstanding={draft.outstanding} onCheck={checkOrders} onContinue={draft.acknowledge} />}
      <fieldset disabled={busy || draft.interrupted} className="min-w-0 space-y-4">
      <Panel className="p-4 space-y-5">
        <CustomerPick initial={initialWho} onPick={(p) => { setWho(p); setQuote(null); }} />
        {who && (
          <DetailSection title={__uiText("2 · สินค้า")} icon="inventory_2">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSkuSearch(skuQ.trim()); }}>
              <SearchInput className="flex-1" aria-label={__uiText("ค้นหาสินค้า")} placeholder={__uiText("รหัสสินค้าหรือชื่อสินค้า")} value={skuQ} onChange={(e) => setSkuQ(e.target.value)} />
              <Button type="submit" icon="search">{__uiText("ค้นหาสินค้า")}</Button>
            </form>
            {skuQ.trim().length > 0 && skuQ.trim().length < 2 && <Hint>{__uiText("พิมพ์อย่างน้อย 2 ตัวอักษร")}</Hint>}
            {products.loading && skuTerm && <Loading variant="table" />}
            <ErrorText error={products.error} onRetry={products.reload} />
            {skuTerm && products.data && !products.data.items.length && <Empty icon="search_off">{__uiText("ไม่พบสินค้าที่ตรงกับคำค้น")}</Empty>}
            {!!products.data?.items.length && (
              <div className="rounded-lg border border-secondary-container divide-y divide-secondary-container/70">
                {products.data.items.map((p) => (
                  <div key={p.product_inventory_id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="font-mono text-[11px] w-36 shrink-0">{p.product_inventory_sku}</span>
                    <span className="flex-1 min-w-0 truncate">{p.name_th ?? p.name_en}</span>
                    <span className="text-on-surface-variant whitespace-nowrap">{fmt.baht(p.selling_unit_price)} / {p.selling_unit ?? '—'}</span>
                    <Button size="sm" icon="add" onClick={() => changeItems([...items.filter((i) => i.id !== p.product_inventory_id), { id: p.product_inventory_id, sku: p.product_inventory_sku, name: p.name_th ?? '', quantity: 1 }])}>{__uiText("เพิ่ม")}</Button>
                  </div>
                ))}
              </div>
            )}
            {!!items.length && (
              <div className="rounded-lg border border-secondary-container overflow-hidden">
                <Table scrollLabel={__uiText("รายการทั้งหมด")}>
                  <THead>
                    <TH>{__uiText("รหัสสินค้า")}</TH>
                    <TH>{__uiText("สินค้า")}</TH>
                    <TH right>{__uiText("จำนวน")}</TH>
                    <TH />
                  </THead>
                  <TBody>
                    {items.map((i) => (
                      <TR key={i.id}>
                        <TD kind="mono">{i.sku}</TD>
                        <TD>{i.name}</TD>
                        <TD kind="num">
                          <Input aria-label={__uiText("จำนวน {0}", {"0": i.sku})} type="number" min={1} className="w-20 text-right" value={i.quantity}
                            onChange={(e) => changeItems(items.map((x) => (x.id === i.id ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                        </TD>
                        <TD kind="actions"><Button size="sm" variant="danger-ghost" icon="close" onClick={() => changeItems(items.filter((x) => x.id !== i.id))}>{__uiText("เอาออก")}</Button></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
            <div><Button variant="primary" icon="calculate" disabled={busy || !items.length} onClick={getQuote}>{__uiText("คิดราคา (josh)")}</Button></div>
          </DetailSection>
        )}
      </Panel>

      {quote != null && (
        <>
          <CodeBlock title={__uiText("รายละเอียดราคาที่คำนวณได้")} value={JSON.stringify(quote, null, 2).slice(0, 4000)} />
          <TaskPanelForm title={__uiText("3 · สั่งซื้อ")} icon="shopping_cart_checkout" cols={3} submitLabel={__uiText("สั่งซื้อ")} messages={taskMessages()} disabled={draft.interrupted || mutation.busy || draft.outstanding} onSubmit={place} onSuccess={r => { draft.clear(); setMsg({ tone: 'ok', text: __uiText('สร้างคำสั่งซื้อแล้ว') + ': ' + ((Array.isArray(r.orderNumbers) ? r.orderNumbers : r.orderIds) as unknown[]).join(', ') }); setItems([]); setQuote(null); }}>
              <TaskSelect name="payment_method" label={__uiText("ชำระด้วย")} value={pay.payment_method} onChange={(e) => setPay({ ...pay, payment_method: e.target.value })}>
                {PAYMENT.map(([k, l]) => <option key={k} value={k}>{__uiText(l)}</option>)}
              </TaskSelect>
            <TaskInput name="coupon_code" label={__uiText("คูปอง")} value={pay.coupon_code} onChange={(e) => setPay({ ...pay, coupon_code: e.target.value })} />
            <TaskInput name="delivery_date" label={__uiText("วันส่ง (ว่าง = ตามรอบ)")} type="date" value={pay.delivery_date} onChange={(e) => setPay({ ...pay, delivery_date: e.target.value })} />
          </TaskPanelForm>
        </>
      )}
      </fieldset>
    </div>
  );
}

export function sampleDecisions(status: string): string[] {
  // Preserve both legacy capabilities: pending → fulfilled and approved → fulfilled.
  return status === 'pending' ? ['approved', 'rejected', 'fulfilled'] : status === 'approved' ? ['fulfilled'] : [];
}

export function Samples() {
  __useUiLocale();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { id, decision } = useParams();
  const rawStatus = params.get('status') ?? '';
  const status = Object.prototype.hasOwnProperty.call(SAMPLE_STATUS, rawStatus) ? rawStatus : '';
  const [saved, setSaved] = useState(false);
  const draftKey = `cp-sample-note:${session.claims()?.sub ?? 'staff'}:${id}:${decision}`;
  const draft = useActionDraft(`cs:sample:${id}:${decision}`, { note: (() => { try { return sessionStorage.getItem(draftKey) ?? ''; } catch { return ''; } })() });
  const note = draft.values.note;
  const [confirmed, setConfirmed] = useState(false);
  useUnsavedChanges((!!id && !!note && !saved) || draft.pending);
  const list = useAsync(async () => rowsOf(await joshAdmin.get('/cs-admin/sample-requests', !id && status ? { status } : undefined)), [status, id]);
  const rows = list.data ?? [];
  const selected = rows.find(row => String(row.id) === id);
  const actionable = !!selected && !!decision && sampleDecisions(String(selected.status)).includes(decision);
  const suffix = params.toString() ? `?${params}` : '';
  const listUrl = `/cs/samples${suffix}`;
  const filter = (next: string) => {
    const updated = new URLSearchParams(params);
    next ? updated.set('status', next) : updated.delete('status');
    setParams(updated);
  };
  async function submit(_data: FormData, signal: AbortSignal) {
    if (saved || !actionable || !confirmed || list.loading || list.error || !draft.begin(signal)) return { ok: false as const, formError: __uiText('ตรวจข้อมูลก่อนบันทึก') };
    try {
      confirmedAnswer(await joshAdmin.call('PATCH', `/cs-admin/sample-requests/${id}`, { status: decision, ...(note.trim() ? { cs_note: note.trim() } : {}) }));
      const fresh = rowsOf(await joshAdmin.get('/cs-admin/sample-requests'));
      const receipt = requireSaved(fresh.find(row => String(row.id) === id), row => row?.status === decision && (!note.trim() || row.cs_note === note.trim()));
      return { ok: true as const, receipt };
    } catch (error) { if (!signal.aborted) draft.fail(error); return writeFailure(error); }
    finally { draft.settle(); }
  }
  function savedReview() {
    draft.clear(); setSaved(true);
    try { sessionStorage.removeItem(draftKey); } catch { /* optional */ }
    list.reload();
  }
  async function checkLatest() {
    const fresh = rowsOf(await joshAdmin.get('/cs-admin/sample-requests'));
    const current = fresh.find(row => String(row.id) === id); list.reload();
    return current ? __uiText('สถานะล่าสุด: {0}', { 0: SAMPLE_STATUS[String(current.status)] ?? show(current.status) }) : __uiText('ไม่พบคำขอนี้');
  }
  const requestSummary = (r: Row) => <KeyValueGrid cols={2} items={[
    { label: __uiText('ลูกค้า'), value: show((r.company as JoshRow)?.name ?? r.company_name ?? r.user_id) },
    { label: __uiText('สินค้า'), value: show((r.product as JoshRow)?.product_inventory_sku ?? r.sku ?? r.product_inventory_id), mono: true },
    { label: __uiText('จำนวน'), value: show(r.quantity) },
    { label: __uiText('สถานะ'), value: <Chip tone={toneOf(String(r.status))} statusCode={String(r.status)} dot>{__uiText(SAMPLE_STATUS[String(r.status)] ?? show(r.status))}</Chip> },
  ]} />;
  const decisionLinks = (r: Row) => <div className="inline-flex gap-1">{sampleDecisions(String(r.status)).map(next => <Button key={next} size="sm" variant={next === 'approved' ? 'primary' : next === 'rejected' ? 'danger-ghost' : 'secondary'} onClick={() => navigate(`/cs/samples/${encodeURIComponent(String(r.id))}/${next}${suffix}`)}>{__uiText(SAMPLE_DECISION[next])}</Button>)}</div>;

  return <Panel className="overflow-hidden">
    <PanelHead icon="science" title={__uiText(id ? 'ตรวจคำขอสินค้าตัวอย่าง' : 'คำขอสินค้าตัวอย่าง')}
      actions={!id && <Segmented value={status} onChange={filter} options={[{ value: '', label: __uiText('ทั้งหมด'), count: !status && !list.loading && !list.error && list.data ? rows.length : undefined }, ...Object.entries(SAMPLE_STATUS).map(([value, label]) => ({ value, label: __uiText(label), count: !list.loading && !list.error && list.data && (!status || status === value) ? rows.filter(row => row.status === value).length : undefined }))]} />} />
    <div className={id ? "space-y-4 p-4" : "space-y-4"}>
      {rawStatus && !status && <Alert tone="warn" actions={<Button onClick={() => filter('')}>{__uiText('ล้างตัวกรอง')}</Button>}>{__uiText('ตัวกรองสถานะไม่ถูกต้อง')}</Alert>}
      {saved && <Alert tone="ok">{__uiText('บันทึกสถานะคำขอแล้ว')} <Link className="underline" to={listUrl}>{__uiText('กลับหน้ารายการ')}</Link></Alert>}
      {draft.interrupted && <InterruptedAction outstanding={draft.outstanding} onCheck={checkLatest} onContinue={draft.acknowledge} />}
      <ErrorText error={list.error} onRetry={list.reload} />
      {list.loading ? <Loading variant={id ? 'detail' : 'table'} /> : !list.error && list.data && <>
        {id ? selected ? <>
          {requestSummary(selected)}
          {!saved && (actionable ? <TaskPanelForm title={__uiText(SAMPLE_DECISION[decision!])} cols={1} messages={taskMessages()} disabled={draft.interrupted || draft.outstanding} onSubmit={submit} onSuccess={savedReview} submitLabel={__uiText('ยืนยันและบันทึก')}>
            <TaskTextarea name="note" label={__uiText('หมายเหตุ')} value={note} onChange={event => {
              draft.set(current => ({ ...current, note: event.target.value }));
              try { sessionStorage.setItem(draftKey, event.target.value); } catch { /* storage may be disabled */ }
            }} />
            <label className="flex items-center gap-2 text-sm"><input name="confirmed" type="checkbox" required disabled={draft.pending || draft.interrupted || draft.outstanding} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{__uiText('ตรวจข้อมูลแล้ว พร้อมบันทึกสถานะ')}</label>
          </TaskPanelForm> : <Alert tone="warn">{__uiText('คำขอนี้เปลี่ยนสถานะแล้ว หรือทำงานนี้ไม่ได้')}</Alert>)}
          {!saved && <Link className="inline-flex min-h-10 items-center text-sm text-primary underline" to={listUrl}>{__uiText('กลับหน้ารายการ')}</Link>}
        </> : <EmptyState title={__uiText('ไม่พบคำขอนี้')} action={<Link to={listUrl}>{__uiText('กลับหน้ารายการ')}</Link>} />
        : rows.length ? <Table scrollLabel={__uiText("รายการทั้งหมด")}><THead><TH>{__uiText('ขอเมื่อ')}</TH><TH>{__uiText('ลูกค้า')}</TH><TH>{__uiText('สินค้า')}</TH><TH right>{__uiText('จำนวน')}</TH><TH>{__uiText('สถานะ')}</TH><TH>{__uiText('หมายเหตุ')}</TH><TH>{__uiText('จัดการ')}</TH></THead>
          <TBody>{rows.map(r => <TR key={String(r.id)}>
            <TD kind="time">{r.created_at ? fmt.when(String(r.created_at)) : '—'}</TD>
            <TD>{show((r.company as JoshRow)?.name ?? r.company_name ?? r.user_id)}</TD>
            <TD kind="mono">{show((r.product as JoshRow)?.product_inventory_sku ?? r.sku ?? r.product_inventory_id)}</TD>
            <TD kind="num">{show(r.quantity)}</TD>
            <TD><Chip tone={toneOf(String(r.status))} statusCode={String(r.status)} dot>{__uiText(SAMPLE_STATUS[String(r.status)] ?? show(r.status))}</Chip></TD>
            <TD kind="muted">{show(r.cs_note)}</TD>
            <TD kind="actions">{decisionLinks(r)}</TD>
          </TR>)}</TBody></Table>
        : <EmptyState icon="science" title={__uiText('ไม่มีคำขอ')} description={__uiText('ไม่มีคำขอที่ตรงกับตัวกรองนี้')} action={status ? <Button onClick={() => filter('')}>{__uiText('ล้างตัวกรอง')}</Button> : <Button icon="refresh" onClick={list.reload}>{__uiText('รีเฟรช')}</Button>} />}
      </>}
    </div>
  </Panel>;
}

function Merge() {
  __useUiLocale();
  const draft = useActionDraft('cs:merge', { primary_user_id: '', duplicate_user_id: '' });
  const v = draft.values;
  const [msg, setMsg] = useState('');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function submit(_data: FormData, signal: AbortSignal) {
    if (!window.confirm(__uiText('รวมบัญชี {0} เข้า {1}?\n\nบัญชีซ้ำจะถูกย้ายข้อมูลเข้าบัญชีหลัก ย้อนกลับไม่ได้', { 0: v.duplicate_user_id, 1: v.primary_user_id }))) return { ok: false as const, formError: __uiText('ยกเลิกการบันทึกแล้ว') };
    if (!draft.begin(signal)) return { ok: false as const, formError: __uiText('ยังยืนยันผลการบันทึกไม่ได้') };
    try { return { ok: true as const, receipt: mergeReceipt(await joshAdmin.call('POST', '/cs-admin/accounts/merge', v)) }; }
    catch (error) { if (!signal.aborted) draft.fail(error); return writeFailure(error); }
    finally { draft.settle(); }
  }
  async function checkAccounts() {
    const latest = await joshCustomerApi.list({ page: 1, limit: 20 });
    if (!Array.isArray(latest.items)) throw new Error(__uiText('ยังยืนยันผลการบันทึกไม่ได้'));
    return __uiText('โหลดบริษัทล่าสุดแล้ว ตรวจรายละเอียดผู้ใช้ของทั้งสองบัญชีในรายงานลูกค้าก่อนลองใหม่');
  }
  return <div className="min-w-0 space-y-4 max-w-2xl">
    {msg && <Alert tone="ok" onClose={() => setMsg('')}>{msg}</Alert>}
    {draft.recovered && !draft.interrupted && <Hint>{__uiText('กู้คืนข้อมูลที่ยังไม่บันทึกแล้ว ตรวจข้อมูลก่อนบันทึก')}</Hint>}
    {draft.interrupted && <InterruptedAction outstanding={draft.outstanding} onCheck={checkAccounts} onContinue={draft.acknowledge} />}
    <TaskPanelForm title={__uiText('รวมบัญชีซ้ำ')} icon="merge" description={__uiText('ดูรหัสผู้ใช้ได้ในหน้ารายละเอียดลูกค้า ใช้ได้เฉพาะผู้ดูแลระบบ และย้อนกลับไม่ได้')} cols={1} messages={taskMessages()} submitLabel={__uiText('รวมบัญชี')} disabled={draft.interrupted || draft.outstanding} onSubmit={submit}
      validate={() => ({ ...(!uuid.test(v.primary_user_id) ? { primary_user_id: __uiText('กรอกรหัสผู้ใช้ให้ครบตามรูปแบบ') } : {}), ...(!uuid.test(v.duplicate_user_id) || v.primary_user_id.toLowerCase() === v.duplicate_user_id.toLowerCase() ? { duplicate_user_id: __uiText('ใส่รหัสผู้ใช้ของสองบัญชีที่ต่างกัน') } : {}) })}
      onSuccess={r => { draft.clear(); setMsg(__uiMessage('รวมแล้ว: {0}', { 0: JSON.stringify(r).slice(0,200) })); }}>
      <TaskInput name="primary_user_id" label={__uiText('บัญชีหลัก (เก็บไว้)')} required className="font-mono" value={v.primary_user_id} onChange={e => draft.set(current => ({ ...current, primary_user_id: e.target.value.trim() }))} />
      <TaskInput name="duplicate_user_id" label={__uiText('บัญชีซ้ำ (รวมเข้า)')} required className="font-mono" value={v.duplicate_user_id} onChange={e => draft.set(current => ({ ...current, duplicate_user_id: e.target.value.trim() }))} />
    </TaskPanelForm>
  </div>;
}
