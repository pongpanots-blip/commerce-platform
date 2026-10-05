import { formatGregorianDateOnly } from './date-only.helper';
import { ErpOrderLineSource, resolveErpOrderLine } from './erp-order-unit.helper';

/**
 * The body of Jagota `POST /order/add-order-create`, built the way josh builds it
 * (josh app/jagota-order/jagota-order.service.ts `buildErpCreateOrderRequest`, origin/main d84d692b).
 * Kept as pure functions over plain rows so commerce can rebuild a request josh already sent
 * and compare (shadow mode) before it ever sends one itself.
 */
export interface ErpCreateOrderItem {
  P_PRODUCT_CODE: string; P_UNIT: string; P_QTY: number; P_RATE: number; P_DELIVERY_DATE: string;
  P_CUST_BRANCH_SEQ: string; P_PO_NUMBER: string; PACKING_REMARKS: string;
}
export interface ErpCreateOrderRequest {
  P_CUST_CODE: string; MAGENTO_ORDER_NO: string; MAGENTO_PARENT_ORDER_NO: string; JOSH_ORDER_NO: number | string; orderItems: ErpCreateOrderItem[];
}

/** josh `JagotaOrderSyncInput`, the fields the ERP request uses. */
export interface ErpOrderInput {
  orderNumber: string;
  parentOrderNumber?: string;
  customerCode: string | null;
  deliveryDate: Date | string | null;
  poNumber?: string | null;
  remark?: string | null;
  lineItems: { productInventoryId: string; quantity: number; unitPrice: number }[];
}

export type InventoryRow = ErpOrderLineSource & { product_inventory_id: string; product_inventory_sku: string };

/** josh `toDateOnlyIso`: Gregorian YYYY-MM-DD, today when missing. */
const toDateOnlyIso = (value: Date | string | null | undefined, now = new Date()) => formatGregorianDateOnly(value) || now.toISOString().slice(0, 10);
/** josh `toErpOrderNo`: numeric shipment numbers go as numbers, legacy ones as text. */
const toErpOrderNo = (orderNumber: string): number | string => (/^\d+$/.test(orderNumber) ? Number(orderNumber) : orderNumber);

export function buildErpCreateOrderRequest(input: ErpOrderInput, inventoryById: Map<string, InventoryRow>, erpBranchSeq: string | null, now = new Date()): ErpCreateOrderRequest {
  const deliveryDate = toDateOnlyIso(input.deliveryDate, now).replace(/-/g, '');
  const custBranchSeq = erpBranchSeq ?? '';
  const poNumber = input.poNumber?.trim() ?? '';
  const remark = input.remark?.trim() ?? '';
  const orderItems = input.lineItems.map((item) => {
    const inventory = inventoryById.get(item.productInventoryId);
    const line = resolveErpOrderLine(inventory, item);
    return {
      P_PRODUCT_CODE: inventory?.product_inventory_sku ?? item.productInventoryId,
      P_UNIT: line.unit, P_QTY: line.qty, P_RATE: line.rate, P_DELIVERY_DATE: deliveryDate,
      P_CUST_BRANCH_SEQ: custBranchSeq, P_PO_NUMBER: poNumber, PACKING_REMARKS: remark,
    };
  });
  return {
    P_CUST_CODE: input.customerCode ?? '',
    MAGENTO_ORDER_NO: input.orderNumber,
    MAGENTO_PARENT_ORDER_NO: input.parentOrderNumber ?? '',
    JOSH_ORDER_NO: toErpOrderNo(input.orderNumber),
    orderItems,
  };
}

export interface FieldDiff { path: string; josh: unknown; commerce: unknown }

/**
 * Field-by-field difference between what josh sent and what commerce would send.
 * Order lines are matched by product code (josh's line order is the DB's, not meaningful),
 * so a reordering is not a mismatch; a missing or extra line is.
 */
export function diffErpRequests(josh: ErpCreateOrderRequest, commerce: ErpCreateOrderRequest): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const same = (a: unknown, b: unknown) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) && typeof a === typeof b : a === b);
  for (const k of ['P_CUST_CODE', 'MAGENTO_ORDER_NO', 'MAGENTO_PARENT_ORDER_NO', 'JOSH_ORDER_NO'] as const) {
    if (!same(josh[k], commerce[k])) diffs.push({ path: k, josh: josh[k], commerce: commerce[k] });
  }
  const group = (items: ErpCreateOrderItem[] = []) => {
    const m = new Map<string, ErpCreateOrderItem[]>();
    for (const i of items) m.set(i.P_PRODUCT_CODE, [...(m.get(i.P_PRODUCT_CODE) ?? []), i]);
    return m;
  };
  const j = group(josh.orderItems);
  const c = group(commerce.orderItems);
  for (const code of new Set([...j.keys(), ...c.keys()])) {
    const a = j.get(code) ?? [];
    const b = c.get(code) ?? [];
    if (a.length !== b.length) { diffs.push({ path: `orderItems[${code}]`, josh: a.length, commerce: b.length }); continue; }
    a.forEach((ai, n) => {
      for (const f of Object.keys({ ...ai, ...b[n] }) as (keyof ErpCreateOrderItem)[]) {
        if (!same(ai[f], b[n][f])) diffs.push({ path: `orderItems[${code}${a.length > 1 ? `#${n + 1}` : ''}].${f}`, josh: ai[f], commerce: b[n][f] });
      }
    });
  }
  return diffs;
}
