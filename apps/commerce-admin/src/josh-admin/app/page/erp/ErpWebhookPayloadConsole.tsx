// ui-metadata-migration: static labels and UI notices only
import {
  simulateErpWebhook,
  type ErpTestingPassthroughEndpoint,
} from '@josh/shared-api';
import { Button } from '@josh/shared-ui-web';
import { useState } from 'react';

/**
 * Console for the payload-driven ERP webhooks (everything except
 * order/invoice status, which have their own shipment-based builder).
 * Each entry ships an editable JSON template = the exact body ERP would
 * send to the real /api/erp/* endpoint; the backend simulator runs it
 * through the real DTO validation + service handler.
 */

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type EndpointSpec = {
  key: ErpTestingPassthroughEndpoint;
  group: string;
  title: string;
  event: string;
  realEndpoint: string;
  effect: string;
  template: unknown;
};

const TODAY = new Date().toISOString().slice(0, 10);

const ENDPOINTS: EndpointSpec[] = [
  {
    key: 'quotations',
    group: 'Quotation',
    title: 'Quotation push',
    event: 'quotation.pushed',
    realEndpoint: 'POST/PUT /api/erp/quotations',
    effect:
      'สร้าง/อัปเดต erp_quotations + special price ราย CUSTOMER_CODE + PRODUCT_CODE (STATUS Y=active, Z=cancelled) — ERP ส่งห่อใน data:[...] หนึ่ง entry ต่อ SEQ_NO',
    template: {
      data: [
        {
          PRODUCT_CODE: 'JP0101010001',
          CUSTOMER_CODE: 'P-063575',
          DOC_BOOK: 'QT',
          DOC_NO: '66371',
          SEQ_NO: '1',
          TRANSACTION_TYPE: 'QT',
          UNIT: 'KG',
          RATE: 250,
          ORDERING_RATE: 250,
          QUANTITY: 10,
          STATUS: 'Y',
          START_DATE: TODAY,
          EXPIRY_DATE: '2026-12-31',
          DOC_DATE: TODAY,
        },
      ],
    },
  },
  {
    key: 'quotations-status',
    group: 'Quotation',
    title: 'Quotation status',
    event: 'quotation.status.changed',
    realEndpoint: 'POST/PUT /api/erp/quotations/status',
    effect:
      'ยืนยัน special price: STATUS Y=approve · Z=cancel · R=reject — correlate ด้วย MAGENTO_QUOTATION_ID ก่อน แล้วค่อย fallback DOC_BOOK/DOC_NO',
    template: {
      data: [
        {
          MAGENTO_QUOTATION_ID: '',
          TRANSACTION_TYPE: 'QT',
          DOC_BOOK: 'QT',
          DOC_NO: '66371',
          STATUS: 'Y',
          details: [
            {
              PRODUCT_CODE: 'JP0101010001',
              RATE: 250,
              QTY: 10,
              VALID_UNTIL_D: '2026-12-31',
            },
          ],
        },
      ],
    },
  },
  {
    key: 'products',
    group: 'Catalog',
    title: 'Product upsert',
    event: 'product.upserted',
    realEndpoint: 'POST /api/erp/products',
    effect:
      'สร้าง/อัปเดต product + translation (field ที่ไม่ส่ง = คงค่าเดิมใน DB) — ORDER_TAKING: Y=order-taking, N=stock · STATUS: N=Active, Z=Cancelled, D=Discontinue',
    template: {
      PRODUCT_CODE: 'JP0101010001',
      PRODUCT_NAME_E: 'Test Product',
      PRODUCT_NAME_T: 'สินค้าทดสอบ',
      GROUP_CODE: 'MEAT',
      BRAND_NAME: 'Josh',
      UNIT: 'KG',
      ORDER_TAKING: 'N',
      PRICE: 250,
      SELLING_UNIT_PRICE: 260,
      SELLING_UNIT: 'KG',
      QUANTITY: 100,
      VAT: '1',
      COUNTRY_CODE: 'TH',
      PACK_SIZE: '1 KG',
      IS_ENABLE: 'Y',
      STATUS: 'N',
      MOQ: 1,
    },
  },
  {
    key: 'products-bulk',
    group: 'Catalog',
    title: 'Product bulk upsert',
    event: 'product.bulk_upserted',
    realEndpoint: 'POST /api/erp/products/bulk',
    effect: 'เหมือน product.upserted แต่รับเป็น array หลาย SKU ในครั้งเดียว',
    template: [
      {
        PRODUCT_CODE: 'JP0101010001',
        PRODUCT_NAME_E: 'Test Product A',
        UNIT: 'KG',
        PRICE: 250,
        STATUS: 'N',
      },
      {
        PRODUCT_CODE: 'JP0101010002',
        PRODUCT_NAME_E: 'Test Product B',
        UNIT: 'KG',
        PRICE: 180,
        STATUS: 'N',
      },
    ],
  },
  {
    key: 'products-image',
    group: 'Catalog',
    title: 'Product image',
    event: 'product.image.changed',
    realEndpoint: 'PUT /api/erp/products/image',
    effect: 'แทนที่รูปทั้งชุดของ SKU ตามลำดับใน IMAGES (full replace ไม่ใช่ append)',
    template: {
      PRODUCT_CODE: 'JP0101010001',
      IMAGES: ['https://example.com/image-1.jpg', 'https://example.com/image-2.jpg'],
    },
  },
  {
    key: 'products-qty',
    group: 'Stock / Price',
    title: 'Qty change',
    event: 'product.qty.changed',
    realEndpoint: 'PUT /api/erp/products/qty',
    effect:
      'อัปเดต stock + sellable qty (≥1 = มีของ, <1 = หมด) — CHANGED_AT กัน event เก่าทับค่าใหม่ · รับได้ทั้ง object เดี่ยวและ array',
    template: {
      PRODUCT_CODE: 'JP0101010001',
      QUANTITY: 50,
      CHANGED_AT: new Date().toISOString(),
      REASON: 'ADJUST',
    },
  },
  {
    key: 'products-moq',
    group: 'Stock / Price',
    title: 'MOQ change',
    event: 'product.moq.changed',
    realEndpoint: 'PUT /api/erp/products/moq',
    effect: 'อัปเดต minimum order quantity ของ SKU',
    template: {
      PRODUCT_CODE: 'JP0101010001',
      MOQ: 5,
    },
  },
  {
    key: 'products-price',
    group: 'Stock / Price',
    title: 'Price change',
    event: 'product.price.changed',
    realEndpoint: 'PUT /api/erp/products/price',
    effect: 'อัปเดตราคา base (ORDERING_PRICE / SELLING_UNIT_PRICE) — ไม่แตะ special price/tier',
    template: {
      PRODUCT_CODE: 'JP0101010001',
      PRICE: {
        ORDERING_PRICE: 250,
        SELLING_UNIT_PRICE: 260,
      },
    },
  },
  {
    key: 'customers',
    group: 'Customer / Company',
    title: 'Customer upsert',
    event: 'customer.upserted',
    realEndpoint: 'POST/PUT /api/erp/customers',
    effect: 'อัปเดตโปรไฟล์/สถานะลูกค้าตาม CUST_CODE (STATUS: active / blocked)',
    template: {
      CUST_CODE: 'P-063575',
      CUSTOMER_NAME_E: 'Test Customer',
      CUSTOMER_NAME_T: 'ลูกค้าทดสอบ',
      CUSTOMER_TYPE: 'B2B',
      PRICE_GROUP: 'A',
      CREDIT_LIMIT: 100000,
      PAYMENT_TERM: '30',
      STATUS: 'active',
    },
  },
  {
    key: 'companies',
    group: 'Customer / Company',
    title: 'Company upsert',
    event: 'company.upserted',
    realEndpoint: 'POST /api/erp/companies',
    effect:
      'สร้าง/อัปเดต company + delivery addresses (→ Branch) — contacts[] ของ ERP จงใจไม่ประมวลผล (ไม่สร้าง user account อัตโนมัติ)',
    template: {
      CUSTOMER_CODE: 'P-063575',
      NAME_E: 'Test Company Co., Ltd.',
      NAME_T: 'บริษัท ทดสอบ จำกัด',
      TAX_ID: '0105500000000',
      CREDIT_LIMIT: 100000,
      deliveryAddresses: [
        {
          CUST_BRANCH: '00000',
          DEL_ADDR_NUM: '99/9',
          DEL_STREET: 'Sukhumvit Rd.',
          LATITUDE: 13.7563,
          LONGITUDE: 100.5018,
          TEL: '020000000',
        },
      ],
    },
  },
  {
    key: 'order-periods',
    group: 'Order period',
    title: 'Supplier order period',
    event: 'order-period.pushed',
    realEndpoint: 'POST/PUT /api/erp/order-periods',
    effect:
      'รอบสั่ง order-taking ระดับ supplier → supplier_order_period (gate ตอน checkout) — STATUS: O=เปิด, N=ยังไม่เปิด',
    template: [
      {
        SUP_CODE: 'S001',
        ORDER_PERIOD: 1,
        DATE_FROM: TODAY,
        DATE_TO: '2026-12-31',
        EST_CLOSE_DATE: '2026-12-25',
        STATUS: 'O',
      },
    ],
  },
];

const GROUPS = [...new Set(ENDPOINTS.map((e) => e.group))];

export default function ErpWebhookPayloadConsole() {
  __useUiLocale();
  const [selectedKey, setSelectedKey] = useState<ErpTestingPassthroughEndpoint>(
    ENDPOINTS[0].key,
  );
  const [payloadByKey, setPayloadByKey] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    endpoint: string;
    response: unknown;
  } | null>(null);

  const spec = ENDPOINTS.find((e) => e.key === selectedKey)!;
  const payloadText =
    payloadByKey[spec.key] ?? JSON.stringify(spec.template, null, 2);

  const pickEndpoint = (key: ErpTestingPassthroughEndpoint) => {
    setSelectedKey(key);
    setError(null);
    setResult(null);
  };

  const setPayload = (text: string) => {
    setPayloadByKey((prev) => ({ ...prev, [spec.key]: text }));
  };

  const resetPayload = () => {
    setPayloadByKey((prev) => {
      const next = { ...prev };
      delete next[spec.key];
      return next;
    });
    setError(null);
  };

  const send = async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setError(__uiMessage("payload ไม่ใช่ JSON ที่ถูกต้อง — แก้ก่อนยิง"));
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await simulateErpWebhook(spec.key, payload);
      setResult({ endpoint: spec.realEndpoint, response });
    } catch (err: any) {
      const message = err?.response?.data?.message;
      setError(
        Array.isArray(message)
          ? message.join(' · ')
          : (message ?? err?.message ?? 'ยิง webhook ไม่สำเร็จ'),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      {/* LEFT: endpoint catalog */}
      <div className="flex flex-col gap-3">
        {GROUPS.map((group) => (
          <div key={group} className="rounded-lg border bg-white p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">{group}</h3>
            <div className="flex flex-col gap-1">
              {ENDPOINTS.filter((e) => e.group === group).map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => pickEndpoint(e.key)}
                  className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-sm hover:border-gray-400 ${
                    selectedKey === e.key ? 'border-primary bg-primary-soft' : 'border-gray-200'
                  }`}
                >
                  <span className="font-medium">{e.title}</span>
                  <span className="font-mono text-[11px] text-gray-400">{e.event}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* RIGHT: payload editor + result */}
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-700">{spec.title}</h3>
            <span className="font-mono text-xs text-gray-500">{spec.realEndpoint}</span>
          </div>
          <p className="mb-3 text-xs text-gray-500">{spec.effect}</p>

          <textarea
            value={payloadText}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            rows={Math.min(24, Math.max(10, payloadText.split('\n').length + 1))}
            className="w-full rounded-md border border-gray-300 bg-gray-50 p-3 font-mono text-xs leading-5 focus:border-primary focus:outline-none"
          />

          {error && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {(typeof error === 'string' ? __uiText(error) : error)}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <button
              type="button"
              onClick={resetPayload}
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              {__uiText("รีเซ็ตเป็น template")}</button>
            <Button
              text={sending ? __uiText("กำลังยิง...") : __uiText("ส่งข้อมูลทดสอบ")}
              onClick={send}
              disabled={sending}
            />
          </div>
        </div>

        {result && (
          <div className="rounded-lg border bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              {__uiText("Response — ")}{result.endpoint}
            </h3>
            <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 font-mono text-xs leading-5 text-green-300">
              {JSON.stringify(result.response, null, 2)}
            </pre>
            <p className="mt-2 text-xs text-gray-400">
              {__uiText("ดู log ของ request นี้เพิ่มได้ที่หน้า ERP Inbound Logs (ผ่าน service ตัวจริง แต่ไม่ผ่าน HTTP interceptor ของ /api/erp/* — row จะไม่ขึ้นใน log viewer)")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
