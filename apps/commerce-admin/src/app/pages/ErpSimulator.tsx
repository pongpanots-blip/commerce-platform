import { useEffect, useState } from 'react';
import { erpSimulatorApi, ErpSimulatorResult, webhookApi, WebhookDeliveryFull } from '../../lib/api';
import { useAsync, statusBadgeClass } from '../hooks';

/**
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

export function ErpSimulator() {
  const { data: info, error: infoError } = useAsync(() => erpSimulatorApi.routes(), []);
  const [route, setRoute] = useState(SPECS[0].route);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ErpSimulatorResult | null>(null);
  const [outgoing, setOutgoing] = useState<WebhookDeliveryFull[]>([]);

  const spec = SPECS.find((s) => s.route === route)!;
  const text = edited[route] ?? JSON.stringify(spec.template, null, 2);

  // After a send: watch what went out to platforms for ~15 s (deliveries are usually there in milliseconds).
  useEffect(() => {
    if (!result) return;
    let stop = false;
    const since = new Date(result.sentAt).getTime() - 1000;
    const poll = async (n: number) => {
      try {
        const all = await webhookApi.deliveries();
        if (!stop) setOutgoing(all.filter((d) => new Date(d.createdAt).getTime() >= since));
      } catch { /* keep the last list */ }
      if (!stop && n < 15) setTimeout(() => void poll(n + 1), 1000);
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
      <div className="page-head">
        <div>
          <h1>ERP simulator</h1>
          <p>ยิง payload แบบที่ ERP ส่งเข้า <span className="mono">/api/erp/*</span> ของ commerce จริง → ingest / relay → ส่งต่อทุก platform ที่ subscribe (josh)</p>
        </div>
      </div>

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
