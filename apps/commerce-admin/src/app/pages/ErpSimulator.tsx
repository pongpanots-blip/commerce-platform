// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import { ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, CodeBlock, DetailPanel, DetailSection, Empty, ErrorText, Field, Hint, Icon, Input, KeyValueGrid, Loading, Page, PageHeader, Panel, PanelHead, SearchInput, Segmented, Span, StatusChip, Table, TBody, TD, TH, THead, TR, Textarea, fmt } from '@cp/ui';
import { erpSimulatorApi, ErpSimulatorResult, JoshOrderResult, JoshOrderTrace, SimProduct, webhookApi, WebhookDeliveryFull } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

/**
 * Both directions of the ERP flow, each through the real HTTP path:
 *   ERP → commerce → josh  (ERP pushes stock/price/order status…; commerce relays to platforms)
 *   josh → commerce → ERP  (josh places an order; once paid, commerce pushes it to the ERP)
 *
 * ERP webhook simulator (moved from josh web-admin's payload console). Sends the
 * exact body the ERP would send to commerce's real /api/erp/* route — same key,
 * DTO, ingest/relay and delivery to every subscribed platform — then shows what
 * went out to platforms. Order/invoice builders that start from a josh shipment
 * stay in josh admin (they read shop orders).
 */

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Spec = { route: string; group: string; title: string; effect: string; template: unknown };

const TODAY = new Date().toISOString().slice(0, 10);
const NOW = () => new Date().toISOString();

const SPECS: Spec[] = [
  { route: 'PUT /erp/products/qty', group: 'Stock / Price', get title() { return __uiText("Qty change"); },
    effect: 'stock ของ SKU (≥1 มีของ, <1 หมด) — CHANGED_AT เก่ากว่าค่าที่มีจะไม่ถูกส่งต่อ · รับ object เดี่ยวหรือ array',
    template: { PRODUCT_CODE: 'JP0101010001', QUANTITY: 50, CHANGED_AT: NOW(), REASON: 'ADJUST' } },
  { route: 'PUT /erp/products/price', group: 'Stock / Price', get title() { return __uiText("Price change"); },
    effect: 'ราคา base (ORDERING_PRICE / SELLING_UNIT_PRICE) — ไม่แตะ special price/tier',
    template: { PRODUCT_CODE: 'JP0101010001', PRICE: { ORDERING_PRICE: 250, SELLING_UNIT_PRICE: 260 } } },
  { route: 'PUT /erp/products/moq', group: 'Stock / Price', get title() { return __uiText("MOQ change"); }, effect: 'minimum order quantity ของ SKU',
    template: { PRODUCT_CODE: 'JP0101010001', MOQ: 5 } },
  { route: 'POST /erp/products', group: 'Catalog', get title() { return __uiText("Product upsert"); },
    effect: 'josh สร้างสินค้าใหม่เป็น draft · field ที่ไม่ส่ง = คงค่าเดิม · STATUS: N=Active, Z=Cancelled, D=Discontinue',
    template: { PRODUCT_CODE: 'JP0101010001', PRODUCT_NAME_E: 'Test Product', PRODUCT_NAME_T: 'สินค้าทดสอบ', GROUP_CODE: 'MEAT', BRAND_NAME: 'Josh',
      UNIT: 'KG', ORDER_TAKING: 'N', PRICE: 250, SELLING_UNIT_PRICE: 260, SELLING_UNIT: 'KG', QUANTITY: 100, VAT: '1', COUNTRY_CODE: 'TH',
      PACK_SIZE: '1 KG', IS_ENABLE: 'Y', STATUS: 'N', MOQ: 1 } },
  { route: 'POST /erp/products/bulk', group: 'Catalog', get title() { return __uiText("Product bulk upsert"); }, effect: 'เหมือน product upsert แต่เป็น array หลาย SKU',
    template: [{ PRODUCT_CODE: 'JP0101010001', PRODUCT_NAME_E: 'Test Product A', UNIT: 'KG', PRICE: 250, STATUS: 'N' },
      { PRODUCT_CODE: 'JP0101010002', PRODUCT_NAME_E: 'Test Product B', UNIT: 'KG', PRICE: 180, STATUS: 'N' }] },
  { route: 'PUT /erp/products/image', group: 'Catalog', get title() { return __uiText("Product image"); }, effect: 'แทนที่รูปทั้งชุดตามลำดับใน IMAGES (ไม่ใช่ append)',
    template: { PRODUCT_CODE: 'JP0101010001', IMAGES: ['https://example.com/image-1.jpg', 'https://example.com/image-2.jpg'] } },
  { route: 'POST /erp/customers', group: 'Customer / Company', get title() { return __uiText("Customer upsert"); }, effect: 'โปรไฟล์/สถานะลูกค้าตาม CUST_CODE (STATUS: active / blocked) · PUT ก็ได้',
    template: { CUST_CODE: 'P-063575', CUSTOMER_NAME_E: 'Test Customer', CUSTOMER_NAME_T: 'ลูกค้าทดสอบ', CUSTOMER_TYPE: 'B2B', PRICE_GROUP: 'A',
      CREDIT_LIMIT: 100000, PAYMENT_TERM: '30', STATUS: 'active' } },
  { route: 'POST /erp/companies', group: 'Customer / Company', get title() { return __uiText("Company upsert"); },
    effect: 'company + delivery addresses (→ Branch) — contacts[] จงใจไม่ประมวลผล',
    template: { CUSTOMER_CODE: 'P-063575', NAME_E: 'Test Company Co., Ltd.', NAME_T: 'บริษัท ทดสอบ จำกัด', TAX_ID: '0105500000000', CREDIT_LIMIT: 100000,
      deliveryAddresses: [{ CUST_BRANCH: '00000', DEL_ADDR_NUM: '99/9', DEL_STREET: 'Sukhumvit Rd.', LATITUDE: 13.7563, LONGITUDE: 100.5018, TEL: '020000000' }] } },
  { route: 'PUT /erp/orders/status', group: 'Order / Invoice', get title() { return __uiText("Order status"); },
    effect: 'raw ERP body — magentoOrderId = เลข shipment ของ josh · ตัวสร้างจาก shipment จริงอยู่ที่ josh admin',
    template: { orderInfo: { magentoOrderId: '100000123', stockProductOrder: [{ DOC_BOOK: 'SO', DOC_NO: '6900123', TRANSACTION_TYPE: 'OD',
      orderStatus: { 'Order Confirmed': 'Y', 'Order Cancelled': 'N', 'Waiting for Confirmation': 'Y' }, products: [{ PRODUCT_CODE: 'JP0101010001' }] }],
      orderTakingProductOrder: [] } } },
  { route: 'PUT /erp/invoices/status', group: 'Order / Invoice', get title() { return __uiText("Invoice status"); },
    effect: 'raw ERP body — ราคาเป็น ex-VAT (PRODUCT_RATE / PRODUCT_TOTAL) · ตัวสร้างจาก shipment จริงอยู่ที่ josh admin',
    template: { orderInfo: { magentoOrderId: '100000123', stockProductOrder: [{ DOC_BOOK: 'SO', DOC_NO: '6900123', TRANSACTION_TYPE: 'OD', haveInvoice: true,
      invoice: { INV_BOOK: 'IV', INV_NO: 1001, FC_NET_AMOUNT: 2336.45, delivery: { Packed: 'Y', 'Out for Delivery': 'N', Delivered: 'N',
        'Delivery Failed': 'N', 'Closed for VAT': 'N', 'Invoice Cancelled': 'N' } },
      products: [{ PRODUCT_CODE: 'JP0101010001', QTY: 10, UNIT: 'KG', PRODUCT_RATE: 233.645, PRODUCT_TOTAL: 2336.45 }] }], orderTakingProductOrder: [] } } },
  { route: 'POST /erp/quotations', group: 'Quotation', get title() { return __uiText("Quotation push"); },
    effect: 'erp_quotations + special price ราย CUSTOMER_CODE + PRODUCT_CODE (STATUS Y=active, Z=cancelled) — ห่อใน data:[...]',
    template: { data: [{ PRODUCT_CODE: 'JP0101010001', CUSTOMER_CODE: 'P-063575', DOC_BOOK: 'QT', DOC_NO: '66371', SEQ_NO: '1', TRANSACTION_TYPE: 'QT',
      UNIT: 'KG', RATE: 250, ORDERING_RATE: 250, QUANTITY: 10, STATUS: 'Y', START_DATE: TODAY, EXPIRY_DATE: '2026-12-31', DOC_DATE: TODAY }] } },
  { route: 'POST /erp/quotations/status', group: 'Quotation', get title() { return __uiText("Quotation status"); },
    effect: 'STATUS Y=approve · Z=cancel · R=reject — correlate ด้วย MAGENTO_QUOTATION_ID ก่อน แล้ว DOC_BOOK/DOC_NO',
    template: { data: [{ MAGENTO_QUOTATION_ID: '', TRANSACTION_TYPE: 'QT', DOC_BOOK: 'QT', DOC_NO: '66371', STATUS: 'Y',
      details: [{ PRODUCT_CODE: 'JP0101010001', RATE: 250, QTY: 10, VALID_UNTIL_D: '2026-12-31' }] }] } },
  { route: 'PUT /erp/order-periods', group: 'Order period', get title() { return __uiText("Supplier order period"); },
    effect: 'รอบสั่งของ supplier ทั้งชุด (รอบที่ไม่อยู่ใน push = ปิด) — STATUS: O=เปิด, N=ยังไม่เปิด',
    template: [{ SUP_CODE: 'S001', ORDER_PERIOD: 1, DATE_FROM: TODAY, DATE_TO: '2026-12-31', EST_CLOSE_DATE: '2026-12-25', STATUS: 'O' }] },
];
const GROUPS = [...new Set(SPECS.map((s) => s.group))];

function ErpToJosh() {
  __useUiLocale();
  const { data: info, error: infoError } = useAsync(() => erpSimulatorApi.routes(), []);
  const [route, setRoute] = useState(SPECS[0].route);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ErpSimulatorResult | null>(null);
  const [outgoing, setOutgoing] = useState<WebhookDeliveryFull[]>([]);
  const [watching, setWatching] = useState(false);

  const spec = SPECS.find((s) => s.route === route)!;
  const text = edited[route] ?? JSON.stringify(spec.template, null, 2);

  // After a send: watch what went out to platforms for ~15 s (deliveries are usually there in milliseconds).
  useEffect(() => {
    if (!result) return;
    let stop = false;
    const since = new Date(result.sentAt).getTime() - 1000;
    setWatching(true);
    const poll = async (n: number) => {
      try {
        const all = await webhookApi.deliveries();
        if (!stop) setOutgoing(all.filter((d) => new Date(d.createdAt).getTime() >= since));
      } catch { /* keep the last list */ }
      if (!stop && n < 15) setTimeout(() => void poll(n + 1), 1000);
      else if (!stop) setWatching(false);
    };
    void poll(0);
    return () => { stop = true; };
  }, [result]);

  async function send() {
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { setError(__uiMessage("payload ไม่ใช่ JSON ที่ถูกต้อง — แก้ก่อนยิง")); return; }
    setSending(true); setError(''); setResult(null); setOutgoing([]);
    try {
      setResult(await erpSimulatorApi.send(route, payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSending(false); }
  }

  return (
    <div className="space-y-4">
      <Flow nodes={[
        { name: 'ERP', state: result ? 'ok' : 'idle', detail: result ? __uiText("ส่ง {0}",{'0':spec.title}) : __uiText("เลือก payload แล้วกดส่ง") },
        { name: 'commerce', state: !result ? 'idle' : result.status < 300 ? 'ok' : 'fail', detail: result ? __uiText("ตอบ {0} ใน {1} ms",{'0':result.status,'1':result.ms}) : __uiText("รับที่ /api/erp/*") },
        { name: 'josh', state: !result || result.status >= 300 || (!outgoing.length && !watching) ? 'idle' : deliveryState(outgoing),
          detail: !result ? __uiText("รับ event ที่ /api/internal/erp-events") : outgoing.length ? deliverySummary(outgoing)
            : watching ? __uiText("รอส่ง…") : __uiText("ไม่มี platform ที่ subscribe event นี้ (commerce เก็บไว้เอง)") },
      ]} />

      <ErrorText error={infoError ? __uiText("Simulator ปิดอยู่หรือเข้าไม่ได้: {0}",{'0':infoError}) : undefined} />
      {info && !info.erpKeyConfigured && (
        <Hint>{__uiText("ยังไม่ได้ตั้ง ERP_WEBHOOK_KEY — dev รับทุก request; production จะตอบ 401")}</Hint>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <div className="space-y-3">
          {GROUPS.map((g) => (
            <Panel key={g}>
              <PanelHead title={g} />
              <div className="flex flex-col gap-1 p-2">
                {SPECS.filter((s) => s.group === g).map((s) => (
                  <button
                    key={s.route}
                    type="button"
                    className={`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                      s.route === route
                        ? 'bg-primary-container text-primary font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
                    }`}
                    onClick={() => { setRoute(s.route); setError(''); setResult(null); setOutgoing([]); }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>{s.title}</span>
                      <span className="font-mono text-[10px] opacity-70">{s.route.split(' ')[0]}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          ))}
        </div>

        <div className="space-y-4">
          <Panel>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-sm">{spec.title}</h3>
                  <p className="text-xs text-on-surface-variant font-mono">{spec.route}</p>
                </div>
              </div>
              <Hint>{spec.effect}</Hint>
              <Textarea
                spellCheck={false}
                value={text}
                rows={Math.min(24, Math.max(10, text.split('\n').length + 1))}
                onChange={(e) => setEdited((p) => ({ ...p, [route]: e.target.value }))}
              />
              <ErrorText error={error} />
              <div className="flex justify-between gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEdited((p) => { const n = { ...p }; delete n[route]; return n; })}>{__uiText("รีเซ็ตเป็น template")}</Button>
                <Button variant="primary" disabled={sending || !info} onClick={send}>{sending ? __uiText("กำลังยิง…") : __uiText("Send as ERP →")}</Button>
              </div>
            </div>
          </Panel>

          {result && (
            <Panel>
              <PanelHead title={__uiText("ERP ได้คำตอบ {0} ใน {1} ms", {"0": result.status, "1": result.ms})} />
              <div className="p-4 space-y-3">
                <CodeBlock title={__uiText("Response")} value={result.response} maxHeight={240} />
                <div>
                  <Hint>{__uiText("ส่งต่อไป platform (")}{outgoing.length})</Hint>
                  {!outgoing.length ? (
                    <Empty>{__uiText("ยังไม่มี — route นี้อาจไม่มี subscription หรือกำลังส่ง")}</Empty>
                  ) : (
                    <Table maxHeight="400px">
                      <THead>
                        <TH>{__uiText("Event")}</TH>
                        <TH>{__uiText("Target")}</TH>
                        <TH>{__uiText("Status")}</TH>
                        <TH right>{__uiText("Code")}</TH>
                        <TH right>{__uiText("Attempts")}</TH>
                        <TH>{__uiText("Error")}</TH>
                      </THead>
                      <TBody>
                        {outgoing.map((d) => (
                          <TR key={d.id}>
                            <TD kind="mono">{d.eventType}</TD>
                            <TD kind="mono" className="text-[11px]">{d.targetUrl}</TD>
                            <TD><StatusChip status={d.status} /></TD>
                            <TD kind="num">{d.statusCode ?? '—'}</TD>
                            <TD kind="num">{d.attempts}</TD>
                            <TD className="text-[11px]">{d.error ?? '—'}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

type NodeState = 'idle' | 'wait' | 'ok' | 'fail';

/** The three boxes with arrows: who sends, who relays, who receives — and how far it got. */
function Flow({ nodes }: { nodes: { name: string; state: NodeState; detail: ReactNode }[] }) {
  __useUiLocale();
  const borderColor: Record<NodeState, string> = {
    idle: 'border-secondary-container',
    wait: 'border-amber-400',
    ok: 'border-emerald-500',
    fail: 'border-rose-500',
  };

  return (
    <div className="flex flex-wrap items-stretch gap-2 mb-4 bg-surface-container-low p-4 rounded-lg border border-secondary-container">
      {nodes.map((n, i) => (
        <div key={n.name} className="flex items-center gap-2 flex-1 min-w-fit">
          {i > 0 && (
            <Icon
              name="arrow_forward"
              size={18}
              className={n.state === 'ok' ? 'text-emerald-500' : 'text-outline'}
            />
          )}
          <div className={`flex-1 min-w-fit border-2 rounded-lg p-3 ${borderColor[n.state]}`}>
            <div className="flex items-center justify-between gap-2 font-semibold text-sm mb-1">
              {n.name}
              <StatusChip status={n.state === 'ok' ? 'ok' : n.state === 'fail' ? 'error' : n.state === 'wait' ? 'pending' : 'draft'} />
            </div>
            <div className="text-xs text-on-surface-variant">{typeof n.detail === 'string' ? __uiText(n.detail) : n.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function deliveryState(d: WebhookDeliveryFull[]): NodeState {
  if (!d.length) return 'wait';
  if (d.some((x) => x.status === 'failed')) return 'fail';
  return d.every((x) => x.status === 'success') ? 'ok' : 'wait';
}
const deliverySummary = (d: WebhookDeliveryFull[]) => {
  const n = (s: string) => d.filter((x) => x.status === s).length;
  return `ส่ง ${d.length} event · สำเร็จ ${n('success')}${n('pending') ? ` · รอ ${n('pending')}` : ''}${n('failed') ? ` · ล้มเหลว ${n('failed')}` : ''}`;
};

const DIRECTIONS = [
  { key: 'erp', get label() { return __uiText("ERP → commerce → josh"); }, get hint() { return __uiText("ERP ส่งสต็อก ราคา สินค้า ลูกค้า สถานะ order/invoice เข้ามา · commerce ส่งต่อให้ josh"); } },
  { key: 'josh', get label() { return __uiText("josh → commerce → ERP"); }, get hint() { return __uiText("josh สั่งซื้อผ่าน commerce · จ่ายเงินแล้ว commerce ส่ง order ไป ERP"); } },
] as const;

export function ErpSimulator() {
  __useUiLocale();
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir') === 'josh' ? 'josh' : 'erp';
  const current = DIRECTIONS.find((d) => d.key === dir)!;
  return (
    <Page>
      <PageHeader
        title={__uiText("ERP simulator")}
        subtitle={__uiText("{0} · ทุกขั้นวิ่งผ่าน HTTP จริงของ commerce", {"0": current.hint})}
      />

      <Segmented
        options={DIRECTIONS.map((d) => ({ value: d.key as typeof dir, label: d.label }))}
        value={dir}
        onChange={(v) => setParams(v === 'erp' ? {} : { dir: v })}
      />

      {dir === 'erp' ? <ErpToJosh /> : <JoshToErp />}
    </Page>
  );
}

type Line = { product: SimProduct; qty: number };

/** josh places an order the way josh does (customer → checkout → payment result); then watch commerce confirm it and push it to the ERP. */
function JoshToErp() {
  __useUiLocale();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const products = useAsync(() => erpSimulatorApi.joshProducts(query), [query]);
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState({ name: 'ร้านทดสอบ simulator', email: 'simulator@example.com', phone: '' });
  const [payment, setPayment] = useState<'paid' | 'failed' | 'none'>('paid');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<JoshOrderResult | null>(null);
  const [trace, setTrace] = useState<JoshOrderTrace | null>(null);

  // After an order: follow it for ~15 s — the ERP push runs right after the order is confirmed.
  useEffect(() => {
    if (!result?.orderId) return;
    let stop = false;
    const poll = async (n: number) => {
      try { const t = await erpSimulatorApi.joshOrderTrace(result.orderId!); if (!stop) setTrace(t); if (t.erp.erpOrderRef) return; } catch { /* keep last */ }
      if (!stop && n < 15) setTimeout(() => void poll(n + 1), 1000);
    };
    void poll(0);
    return () => { stop = true; };
  }, [result]);

  const add = (p: SimProduct) => setLines((ls) => ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, qty: 1 }]);
  async function send() {
    setSending(true); setError(''); setResult(null); setTrace(null);
    try {
      setResult(await erpSimulatorApi.joshOrder({
        customer, payment, lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: Number(l.product.price ?? 0) })),
      }));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSending(false); }
  }

  const step = (name: string) => result?.steps.find((s) => s.step === name);
  const failed = result?.steps.find((s) => s.status >= 300);
  const order = trace?.order;
  // josh only sends; a 4xx/5xx is commerce refusing, so it lights the commerce box.
  const joshState: NodeState = !result ? 'idle' : 'ok';
  const reason = (r: unknown) => { const e = (r as { error?: { message?: unknown }; message?: unknown }); const m = e?.error?.message ?? e?.message; return Array.isArray(m) ? m.join(', ') : String(m ?? ''); };
  const commerceState: NodeState = !result || !step('checkout') ? (failed ? 'fail' : 'idle')
    : !order ? 'wait' : order.status === 'confirmed' ? 'ok' : ['failed', 'cancelled', 'expired'].includes(order.status) ? 'fail' : 'wait';
  const erpState: NodeState = !trace ? 'idle' : trace.erp.erpOrderRef ? 'ok' : !trace.erp.integration ? 'fail' : order?.status === 'confirmed' ? 'wait' : 'idle';

  return (
    <div className="space-y-4">
      <Flow nodes={[
        { name: 'josh', state: joshState, detail: !result ? __uiText("ลูกค้ากดสั่งซื้อ") : result.steps.map((s) => `${s.step} ${s.status}`).join(' · ') },
        { name: 'commerce', state: commerceState, detail: failed ? __uiText("{0} ถูกปฏิเสธ {1}: {2}",{'0':failed.step,'1':failed.status,'2':reason(failed.response)}) : !order ? __uiText("จองสต็อก → สร้าง order → รอจ่าย") :
          __uiText("order {0} · จอง {1}/{2} รายการ",{'0':order.status,'1':trace!.reservations.filter((r) => r.status === 'reserved' || r.status === 'confirmed').length,'2':trace!.reservations.length}) },
        { name: 'ERP', state: erpState, detail: !trace ? __uiText("รับ order เมื่อจ่ายเงินแล้ว") : trace.erp.erpOrderRef
          ? __uiText("ได้เลข {0}{1}",{'0':trace.erp.erpOrderRef,'1':trace.erp.liveMode ? '' : ' (mock — liveMode ปิด)'})
          : !trace.erp.integration ? __uiText("ไม่มี ERP integration ที่ active") : order?.status === 'confirmed' ? __uiText("กำลังส่ง…") : __uiText("ไม่ส่ง (order ยังไม่ยืนยัน)") },
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
        <Panel>
          <PanelHead title={__uiText("สินค้า (catalog ที่ josh เห็น)")} />
          <div className="p-3">
            <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={__uiText("ค้นหาชื่อ / SKU")} />
              <Button size="sm" variant="secondary" type="submit">{__uiText("ค้นหา")}</Button>
            </form>
            <ErrorText error={products.error} />
            <Table maxHeight="400px">
              <THead>
                <TH>{__uiText("SKU")}</TH>
                <TH>{__uiText("สินค้า")}</TH>
                <TH right>{__uiText("พร้อมขาย")}</TH>
                <TH></TH>
              </THead>
              <TBody>
                {(products.data?.items ?? []).map((p) => (
                  <TR key={p.id}>
                    <TD kind="mono">{p.sku}</TD>
                    <TD>{p.name}</TD>
                    <TD kind="num">{p.stock}</TD>
                    <TD kind="actions">
                      <Button size="sm" variant="ghost" onClick={() => add(p)} disabled={lines.some((l) => l.product.id === p.id)}>{__uiText("เพิ่ม")}</Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Panel>

        <Panel>
          <PanelHead title={__uiText("order ของ josh")} />
          <form className="p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label={__uiText("ชื่อลูกค้า")}>
                <Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
              </Field>
              <Field label={__uiText("อีเมล")}>
                <Input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
              </Field>
              <Field label={__uiText("เบอร์")}>
                <Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
              </Field>
            </div>

            {lines.length ? (
              <div>
                <p className="text-xs font-semibold text-on-surface-variant mb-2">{__uiText("สินค้าในตะกร้า")}</p>
                <Table maxHeight="240px">
                  <THead>
                    <TH>{__uiText("สินค้า")}</TH>
                    <TH right>{__uiText("ราคา")}</TH>
                    <TH right>{__uiText("จำนวน")}</TH>
                    <TH></TH>
                  </THead>
                  <TBody>
                    {lines.map((l) => (
                      <TR key={l.product.id}>
                        <TD>
                          {l.product.name}
                          <div className="text-[10px] font-mono text-on-surface-variant">{l.product.sku}</div>
                        </TD>
                        <TD kind="money">{fmt.baht(l.product.price ?? 0)}</TD>
                        <TD kind="num">
                          <Input
                            type="number"
                            min={1}
                            value={l.qty}
                            className="w-16"
                            onChange={(e) => setLines((ls) => ls.map((x) => x.product.id === l.product.id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))}
                          />
                        </TD>
                        <TD kind="actions">
                          <Button size="sm" variant="danger-ghost" onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))}>{__uiText("ลบ")}</Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            ) : (
              <Empty>{__uiText("เพิ่มสินค้าจากรายการด้านซ้าย")}</Empty>
            )}

            <Field label={__uiText("หลังสั่งซื้อ josh แจ้งว่า")}>
              <select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} className="w-full px-2.5 py-1.5 bg-surface-container-low text-on-surface placeholder:text-outline border border-secondary-container rounded-lg text-xs">
                <option value="paid">{__uiText("จ่ายแล้ว → commerce ยืนยัน order → ส่งไป ERP")}</option>
                <option value="failed">{__uiText("จ่ายไม่สำเร็จ → ไม่ส่ง ERP")}</option>
                <option value="none">{__uiText("ยังไม่จ่าย (ค้างรอจ่าย)")}</option>
              </select>
            </Field>

            <ErrorText error={error} />
            <div className="flex justify-end">
              <Button variant="primary" disabled={sending || !lines.length || !customer.name.trim()} type="submit">{sending ? __uiText("กำลังส่ง…") : __uiText("Send as josh →")}</Button>
            </div>
          </form>
        </Panel>
      </div>

      {result && (
        <Panel>
          <PanelHead title={__uiText("josh เรียก commerce")} />
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TH>{__uiText("ขั้น")}</TH>
                <TH>{__uiText("Call")}</TH>
                <TH>{__uiText("Status")}</TH>
                <TH right>{__uiText("ms")}</TH>
                <TH>{__uiText("คำตอบ")}</TH>
              </THead>
              <TBody>
                {result.steps.map((s) => (
                  <TR key={s.step}>
                    <TD>{s.step}</TD>
                    <TD kind="mono" className="text-[11px]">{s.call}</TD>
                    <TD><StatusChip status={s.status < 300 ? 'ok' : 'error'} /></TD>
                    <TD kind="num">{s.ms}</TD>
                    <TD className="text-[11px]"><pre className="overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(s.response, null, 2).slice(0, 120)}</pre></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {trace && (
            <div className="p-4 space-y-4">
              <DetailSection title={__uiText("สต็อกที่จอง")}>
                <Table maxHeight="240px">
                  <THead>
                    <TH>{__uiText("SKU")}</TH>
                    <TH right>{__uiText("จำนวน")}</TH>
                    <TH>{__uiText("สถานะ")}</TH>
                    <TH>{__uiText("เหตุผล")}</TH>
                  </THead>
                  <TBody>
                    {trace.reservations.map((r, i) => (
                      <TR key={i}>
                        <TD kind="mono">{r.sku}</TD>
                        <TD kind="num">{r.qty}</TD>
                        <TD><StatusChip status={r.status} /></TD>
                        <TD>{r.fail_reason ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </DetailSection>

              <DetailSection title={__uiText("event ของ order นี้")}>
                <Table maxHeight="240px">
                  <THead>
                    <TH>{__uiText("Event")}</TH>
                    <TH>{__uiText("สถานะ")}</TH>
                    <TH kind="time">{__uiText("เวลา")}</TH>
                  </THead>
                  <TBody>
                    {trace.events.map((e, i) => (
                      <TR key={i}>
                        <TD kind="mono">{e.type}</TD>
                        <TD>{e.status}</TD>
                        <TD kind="time">{new Date(e.created_at).toLocaleTimeString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'))}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </DetailSection>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

