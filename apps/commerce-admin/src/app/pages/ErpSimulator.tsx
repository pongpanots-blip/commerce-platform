import { ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

type Spec = { route: string; group: string; title: string; effect: string; template: unknown };

const TODAY = new Date().toISOString().slice(0, 10);
const NOW = () => new Date().toISOString();

const SPECS: Spec[] = [
  { route: 'PUT /erp/products/qty', group: 'Stock / Price', title: 'Qty change',
    effect: 'stock ของ SKU (≥1 มีของ, <1 หมด) — CHANGED_AT เก่ากว่าค่าที่มีจะไม่ถูกส่งต่อ · รับ object เดี่ยวหรือ array',
    template: { PRODUCT_CODE: 'JP0101010001', QUANTITY: 50, CHANGED_AT: NOW(), REASON: 'ADJUST' } },
  { route: 'PUT /erp/products/price', group: 'Stock / Price', title: 'Price change',
    effect: 'ราคา base (ORDERING_PRICE / SELLING_UNIT_PRICE) — ไม่แตะ special price/tier',
    template: { PRODUCT_CODE: 'JP0101010001', PRICE: { ORDERING_PRICE: 250, SELLING_UNIT_PRICE: 260 } } },
  { route: 'PUT /erp/products/moq', group: 'Stock / Price', title: 'MOQ change', effect: 'minimum order quantity ของ SKU',
    template: { PRODUCT_CODE: 'JP0101010001', MOQ: 5 } },
  { route: 'POST /erp/products', group: 'Catalog', title: 'Product upsert',
    effect: 'josh สร้างสินค้าใหม่เป็น draft · field ที่ไม่ส่ง = คงค่าเดิม · STATUS: N=Active, Z=Cancelled, D=Discontinue',
    template: { PRODUCT_CODE: 'JP0101010001', PRODUCT_NAME_E: 'Test Product', PRODUCT_NAME_T: 'สินค้าทดสอบ', GROUP_CODE: 'MEAT', BRAND_NAME: 'Josh',
      UNIT: 'KG', ORDER_TAKING: 'N', PRICE: 250, SELLING_UNIT_PRICE: 260, SELLING_UNIT: 'KG', QUANTITY: 100, VAT: '1', COUNTRY_CODE: 'TH',
      PACK_SIZE: '1 KG', IS_ENABLE: 'Y', STATUS: 'N', MOQ: 1 } },
  { route: 'POST /erp/products/bulk', group: 'Catalog', title: 'Product bulk upsert', effect: 'เหมือน product upsert แต่เป็น array หลาย SKU',
    template: [{ PRODUCT_CODE: 'JP0101010001', PRODUCT_NAME_E: 'Test Product A', UNIT: 'KG', PRICE: 250, STATUS: 'N' },
      { PRODUCT_CODE: 'JP0101010002', PRODUCT_NAME_E: 'Test Product B', UNIT: 'KG', PRICE: 180, STATUS: 'N' }] },
  { route: 'PUT /erp/products/image', group: 'Catalog', title: 'Product image', effect: 'แทนที่รูปทั้งชุดตามลำดับใน IMAGES (ไม่ใช่ append)',
    template: { PRODUCT_CODE: 'JP0101010001', IMAGES: ['https://example.com/image-1.jpg', 'https://example.com/image-2.jpg'] } },
  { route: 'POST /erp/customers', group: 'Customer / Company', title: 'Customer upsert', effect: 'โปรไฟล์/สถานะลูกค้าตาม CUST_CODE (STATUS: active / blocked) · PUT ก็ได้',
    template: { CUST_CODE: 'P-063575', CUSTOMER_NAME_E: 'Test Customer', CUSTOMER_NAME_T: 'ลูกค้าทดสอบ', CUSTOMER_TYPE: 'B2B', PRICE_GROUP: 'A',
      CREDIT_LIMIT: 100000, PAYMENT_TERM: '30', STATUS: 'active' } },
  { route: 'POST /erp/companies', group: 'Customer / Company', title: 'Company upsert',
    effect: 'company + delivery addresses (→ Branch) — contacts[] จงใจไม่ประมวลผล',
    template: { CUSTOMER_CODE: 'P-063575', NAME_E: 'Test Company Co., Ltd.', NAME_T: 'บริษัท ทดสอบ จำกัด', TAX_ID: '0105500000000', CREDIT_LIMIT: 100000,
      deliveryAddresses: [{ CUST_BRANCH: '00000', DEL_ADDR_NUM: '99/9', DEL_STREET: 'Sukhumvit Rd.', LATITUDE: 13.7563, LONGITUDE: 100.5018, TEL: '020000000' }] } },
  { route: 'PUT /erp/orders/status', group: 'Order / Invoice', title: 'Order status',
    effect: 'raw ERP body — magentoOrderId = เลข shipment ของ josh · ตัวสร้างจาก shipment จริงอยู่ที่ josh admin',
    template: { orderInfo: { magentoOrderId: '100000123', stockProductOrder: [{ DOC_BOOK: 'SO', DOC_NO: '6900123', TRANSACTION_TYPE: 'OD',
      orderStatus: { 'Order Confirmed': 'Y', 'Order Cancelled': 'N', 'Waiting for Confirmation': 'Y' }, products: [{ PRODUCT_CODE: 'JP0101010001' }] }],
      orderTakingProductOrder: [] } } },
  { route: 'PUT /erp/invoices/status', group: 'Order / Invoice', title: 'Invoice status',
    effect: 'raw ERP body — ราคาเป็น ex-VAT (PRODUCT_RATE / PRODUCT_TOTAL) · ตัวสร้างจาก shipment จริงอยู่ที่ josh admin',
    template: { orderInfo: { magentoOrderId: '100000123', stockProductOrder: [{ DOC_BOOK: 'SO', DOC_NO: '6900123', TRANSACTION_TYPE: 'OD', haveInvoice: true,
      invoice: { INV_BOOK: 'IV', INV_NO: 1001, FC_NET_AMOUNT: 2336.45, delivery: { Packed: 'Y', 'Out for Delivery': 'N', Delivered: 'N',
        'Delivery Failed': 'N', 'Closed for VAT': 'N', 'Invoice Cancelled': 'N' } },
      products: [{ PRODUCT_CODE: 'JP0101010001', QTY: 10, UNIT: 'KG', PRODUCT_RATE: 233.645, PRODUCT_TOTAL: 2336.45 }] }], orderTakingProductOrder: [] } } },
  { route: 'POST /erp/quotations', group: 'Quotation', title: 'Quotation push',
    effect: 'erp_quotations + special price ราย CUSTOMER_CODE + PRODUCT_CODE (STATUS Y=active, Z=cancelled) — ห่อใน data:[...]',
    template: { data: [{ PRODUCT_CODE: 'JP0101010001', CUSTOMER_CODE: 'P-063575', DOC_BOOK: 'QT', DOC_NO: '66371', SEQ_NO: '1', TRANSACTION_TYPE: 'QT',
      UNIT: 'KG', RATE: 250, ORDERING_RATE: 250, QUANTITY: 10, STATUS: 'Y', START_DATE: TODAY, EXPIRY_DATE: '2026-12-31', DOC_DATE: TODAY }] } },
  { route: 'POST /erp/quotations/status', group: 'Quotation', title: 'Quotation status',
    effect: 'STATUS Y=approve · Z=cancel · R=reject — correlate ด้วย MAGENTO_QUOTATION_ID ก่อน แล้ว DOC_BOOK/DOC_NO',
    template: { data: [{ MAGENTO_QUOTATION_ID: '', TRANSACTION_TYPE: 'QT', DOC_BOOK: 'QT', DOC_NO: '66371', STATUS: 'Y',
      details: [{ PRODUCT_CODE: 'JP0101010001', RATE: 250, QTY: 10, VALID_UNTIL_D: '2026-12-31' }] }] } },
  { route: 'PUT /erp/order-periods', group: 'Order period', title: 'Supplier order period',
    effect: 'รอบสั่งของ supplier ทั้งชุด (รอบที่ไม่อยู่ใน push = ปิด) — STATUS: O=เปิด, N=ยังไม่เปิด',
    template: [{ SUP_CODE: 'S001', ORDER_PERIOD: 1, DATE_FROM: TODAY, DATE_TO: '2026-12-31', EST_CLOSE_DATE: '2026-12-25', STATUS: 'O' }] },
];
const GROUPS = [...new Set(SPECS.map((s) => s.group))];

function ErpToJosh() {
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
    try { payload = JSON.parse(text); } catch { setError('payload ไม่ใช่ JSON ที่ถูกต้อง — แก้ก่อนยิง'); return; }
    setSending(true); setError(''); setResult(null); setOutgoing([]);
    try {
      setResult(await erpSimulatorApi.send(route, payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSending(false); }
  }

  return (
    <div>
      <Flow nodes={[
        { name: 'ERP', state: result ? 'ok' : 'idle', detail: result ? `ส่ง ${spec.title}` : 'เลือก payload แล้วกดส่ง' },
        { name: 'commerce', state: !result ? 'idle' : result.status < 300 ? 'ok' : 'fail', detail: result ? `ตอบ ${result.status} ใน ${result.ms} ms` : 'รับที่ /api/erp/*' },
        { name: 'josh', state: !result || result.status >= 300 || (!outgoing.length && !watching) ? 'idle' : deliveryState(outgoing),
          detail: !result ? 'รับ event ที่ /api/internal/erp-events' : outgoing.length ? deliverySummary(outgoing)
            : watching ? 'รอส่ง…' : 'ไม่มี platform ที่ subscribe event นี้ (commerce เก็บไว้เอง)' },
      ]} />

      {infoError && <div className="panel" style={{ padding: 16, color: '#c2333f' }}>Simulator ปิดอยู่หรือเข้าไม่ได้: {infoError}</div>}
      {info && !info.erpKeyConfigured && <div className="panel" style={{ padding: 12, marginBottom: 12 }}>ยังไม่ได้ตั้ง ERP_WEBHOOK_KEY — dev รับทุก request; production จะตอบ 401</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {GROUPS.map((g) => (
            <div key={g} className="panel">
              <div className="panel-head">{g}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8 }}>
                {SPECS.filter((s) => s.group === g).map((s) => (
                  <button key={s.route} type="button" className={`btn ${s.route === route ? '' : 'ghost'} sm`} style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => { setRoute(s.route); setError(''); setResult(null); setOutgoing([]); }}>
                    {s.title}<span className="mono" style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>{s.route.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>{spec.title}</strong><span className="mono">{spec.route}</span>
            </div>
            <p className="hint" style={{ margin: '6px 0 10px' }}>{spec.effect}</p>
            <textarea className="mono" spellCheck={false} value={text} rows={Math.min(24, Math.max(10, text.split('\n').length + 1))}
              onChange={(e) => setEdited((p) => ({ ...p, [route]: e.target.value }))} style={{ width: '100%', fontSize: 12 }} />
            {error && <div style={{ marginTop: 8, color: '#c2333f' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <button type="button" className="btn ghost sm" onClick={() => setEdited((p) => { const n = { ...p }; delete n[route]; return n; })}>รีเซ็ตเป็น template</button>
              <button type="button" className="btn" disabled={sending || !info} onClick={send}>{sending ? 'กำลังยิง…' : 'Send as ERP →'}</button>
            </div>
          </div>

          {result && (
            <div className="panel" style={{ padding: 16 }}>
              <div className="panel-head" style={{ padding: 0, marginBottom: 8 }}>
                ERP ได้คำตอบ <span className={statusBadgeClass(result.status < 300 ? 'success' : 'failed')}>{result.status}</span> ใน {result.ms} ms
              </div>
              <pre className="payload">{JSON.stringify(result.response, null, 2)}</pre>
              <div className="hint" style={{ margin: '12px 0 6px' }}>ส่งต่อไป platform ({outgoing.length})</div>
              {!outgoing.length ? <div className="empty">ยังไม่มี — route นี้อาจไม่มี subscription หรือกำลังส่ง</div> : (
                <table>
                  <thead><tr><th>Event</th><th>Target</th><th>Status</th><th>Code</th><th>Attempts</th><th>Error</th></tr></thead>
                  <tbody>{outgoing.map((d) => (
                    <tr key={d.id}><td className="mono">{d.eventType}</td><td className="mono" style={{ fontSize: 12 }}>{d.targetUrl}</td>
                      <td><span className={statusBadgeClass(d.status)}>{d.status}</span></td><td>{d.statusCode ?? '—'}</td><td>{d.attempts}</td>
                      <td style={{ fontSize: 12 }}>{d.error ?? '—'}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type NodeState = 'idle' | 'wait' | 'ok' | 'fail';
const NODE_COLOR: Record<NodeState, string> = { idle: 'var(--line)', wait: 'var(--warn)', ok: 'var(--ok)', fail: 'var(--danger)' };

/** The three boxes with arrows: who sends, who relays, who receives — and how far it got. */
function Flow({ nodes }: { nodes: { name: string; state: NodeState; detail: ReactNode }[] }) {
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap' }}>
      {nodes.map((n, i) => (
        <div key={n.name} style={{ display: 'contents' }}>
          {i > 0 && <div aria-hidden style={{ alignSelf: 'center', fontSize: 22, color: nodes[i - 1].state === 'ok' ? 'var(--ok)' : 'var(--muted)' }}>→</div>}
          <div style={{ flex: '1 1 160px', border: `2px solid ${NODE_COLOR[n.state]}`, borderRadius: 8, padding: '10px 12px', minWidth: 0 }}>
            <div style={{ fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              {n.name}
              <span className={`badge ${n.state === 'ok' ? 'ok' : n.state === 'fail' ? 'danger' : n.state === 'wait' ? 'warn' : 'muted'}`}>
                {n.state === 'ok' ? 'ผ่าน' : n.state === 'fail' ? 'ไม่ผ่าน' : n.state === 'wait' ? 'รอ' : '—'}
              </span>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>{n.detail}</div>
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
  { key: 'erp', label: 'ERP → commerce → josh', hint: 'ERP ส่งสต็อก ราคา สินค้า ลูกค้า สถานะ order/invoice เข้ามา · commerce ส่งต่อให้ josh' },
  { key: 'josh', label: 'josh → commerce → ERP', hint: 'josh สั่งซื้อผ่าน commerce · จ่ายเงินแล้ว commerce ส่ง order ไป ERP' },
] as const;

export function ErpSimulator() {
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir') === 'josh' ? 'josh' : 'erp';
  const current = DIRECTIONS.find((d) => d.key === dir)!;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>ERP simulator</h1>
          <p>{current.hint} · ทุกขั้นวิ่งผ่าน HTTP จริงของ commerce</p>
        </div>
      </div>
      <div className="row" role="tablist" style={{ marginBottom: 12 }}>
        {DIRECTIONS.map((d) => (
          <button key={d.key} type="button" role="tab" aria-selected={dir === d.key} className={`btn ${dir === d.key ? '' : 'ghost'}`}
            onClick={() => setParams(d.key === 'erp' ? {} : { dir: d.key })}>{d.label}</button>
        ))}
      </div>
      {dir === 'erp' ? <ErpToJosh /> : <JoshToErp />}
    </div>
  );
}

type Line = { product: SimProduct; qty: number };

/** josh places an order the way josh does (customer → checkout → payment result); then watch commerce confirm it and push it to the ERP. */
function JoshToErp() {
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
    <div>
      <Flow nodes={[
        { name: 'josh', state: joshState, detail: !result ? 'ลูกค้ากดสั่งซื้อ' : result.steps.map((s) => `${s.step} ${s.status}`).join(' · ') },
        { name: 'commerce', state: commerceState, detail: failed ? `${failed.step} ถูกปฏิเสธ ${failed.status}: ${reason(failed.response)}` : !order ? 'จองสต็อก → สร้าง order → รอจ่าย' :
          `order ${order.status} · จอง ${trace!.reservations.filter((r) => r.status === 'reserved' || r.status === 'confirmed').length}/${trace!.reservations.length} รายการ` },
        { name: 'ERP', state: erpState, detail: !trace ? 'รับ order เมื่อจ่ายเงินแล้ว' : trace.erp.erpOrderRef
          ? `ได้เลข ${trace.erp.erpOrderRef}${trace.erp.liveMode ? '' : ' (mock — liveMode ปิด)'}`
          : !trace.erp.integration ? 'ไม่มี ERP integration ที่ active' : order?.status === 'confirmed' ? 'กำลังส่ง…' : 'ไม่ส่ง (order ยังไม่ยืนยัน)' },
      ]} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(300px, 1.2fr)', gap: 16 }}>
        <div className="panel">
          <div className="panel-head">สินค้า (catalog ที่ josh เห็น)</div>
          <form className="row" style={{ padding: 12 }} onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ / SKU" style={{ flex: 1 }} />
            <button className="btn ghost sm" type="submit">ค้นหา</button>
          </form>
          {products.error && <div className="err" style={{ padding: '0 12px' }}>{products.error}</div>}
          <table>
            <thead><tr><th>SKU</th><th>สินค้า</th><th>พร้อมขาย</th><th></th></tr></thead>
            <tbody>
              {(products.data?.items ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.sku}</td><td>{p.name}</td><td>{p.stock}</td>
                  <td><button type="button" className="btn ghost sm" onClick={() => add(p)} disabled={lines.some((l) => l.product.id === p.id)}>เพิ่ม</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head">order ของ josh</div>
          <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
            <div className="row">
              <label className="field">ชื่อลูกค้า<input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></label>
              <label className="field">อีเมล<input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></label>
              <label className="field">เบอร์<input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></label>
            </div>
            {lines.length ? (
              <table>
                <thead><tr><th>สินค้า</th><th>ราคา</th><th>จำนวน</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.product.id}>
                      <td>{l.product.name}<div className="hint mono">{l.product.sku}</div></td>
                      <td>{l.product.price ?? 0}</td>
                      <td><input type="number" min={1} value={l.qty} style={{ width: 72 }}
                        onChange={(e) => setLines((ls) => ls.map((x) => x.product.id === l.product.id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} /></td>
                      <td><button type="button" className="btn ghost sm" onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))}>ลบ</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">เพิ่มสินค้าจากรายการด้านซ้าย</div>}
            <label className="field">หลังสั่งซื้อ josh แจ้งว่า
              <select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}>
                <option value="paid">จ่ายแล้ว → commerce ยืนยัน order → ส่งไป ERP</option>
                <option value="failed">จ่ายไม่สำเร็จ → ไม่ส่ง ERP</option>
                <option value="none">ยังไม่จ่าย (ค้างรอจ่าย)</option>
              </select>
            </label>
            {error && <div className="err">{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" disabled={sending || !lines.length || !customer.name.trim()} onClick={send}>{sending ? 'กำลังส่ง…' : 'Send as josh →'}</button>
            </div>
          </div>
        </div>
      </div>

      {result && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">josh เรียก commerce</div>
          <table>
            <thead><tr><th>ขั้น</th><th>Call</th><th>Status</th><th>ms</th><th>คำตอบ</th></tr></thead>
            <tbody>
              {result.steps.map((s) => (
                <tr key={s.step}>
                  <td>{s.step}</td><td className="mono" style={{ fontSize: 12 }}>{s.call}</td>
                  <td><span className={statusBadgeClass(s.status < 300 ? 'success' : 'failed')}>{s.status}</span></td><td>{s.ms}</td>
                  <td><pre className="payload" style={{ margin: 0, maxHeight: 160 }}>{JSON.stringify(s.response, null, 2)}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
          {trace && (
            <div style={{ padding: 16 }}>
              <div className="hint">สต็อกที่จอง</div>
              <table>
                <thead><tr><th>SKU</th><th>จำนวน</th><th>สถานะ</th><th>เหตุผล</th></tr></thead>
                <tbody>{trace.reservations.map((r, i) => <tr key={i}><td className="mono">{r.sku}</td><td>{r.qty}</td><td><span className={statusBadgeClass(r.status)}>{r.status}</span></td><td>{r.fail_reason ?? '—'}</td></tr>)}</tbody>
              </table>
              <div className="hint" style={{ marginTop: 12 }}>event ของ order นี้</div>
              <table>
                <thead><tr><th>Event</th><th>สถานะ</th><th>เวลา</th></tr></thead>
                <tbody>{trace.events.map((e, i) => <tr key={i}><td className="mono">{e.type}</td><td>{e.status}</td><td>{new Date(e.created_at).toLocaleTimeString('th-TH')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

