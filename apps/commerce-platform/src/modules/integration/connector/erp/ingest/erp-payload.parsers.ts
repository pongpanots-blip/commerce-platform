/**
 * Anti-corruption layer: the ONLY file in the platform that knows Oracle EBS
 * field names (SEGMENT1, INVENTORY_ITEM_ID, SUBINVENTORY_CODE, ...). Every
 * parser takes a raw inbound payload of unknown shape, validates the fields
 * it needs, and returns a plain platform-shaped object. No other module may
 * reference an Oracle field name directly.
 */

export interface ParsedProduct {
  sku: string;
  name: string;
  status: 'active' | 'inactive';
  leadTimeDays: number | null;
  listPrice: string | null;
  uom: string | null;
  externalId: string;
}

export interface ParsedStock {
  sku: string | null;
  externalItemId: string | null;
  warehouseCode: string;
  quantity: number;
}

export interface ParsedCustomer {
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  externalId: string;
}

export interface ParsedSaleOrder {
  orderNumber: string;
  orderedDate: string | null;
  soldToAccount: string | null;
  lines: { sku: string; qty: number; unitPrice: string }[];
}

function asRecord(raw: unknown): Record<string, unknown> {
  return (raw ?? {}) as Record<string, unknown>;
}

function requireField(raw: Record<string, unknown>, field: string): unknown {
  const value = raw[field];
  if (value === undefined || value === null || value === '') {
    throw new Error(`ERP payload missing required field ${field}`);
  }
  return value;
}

function money(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return Number(value).toFixed(2);
}

export function parseErpProduct(raw: unknown): ParsedProduct {
  const r = asRecord(raw);
  const sku = requireField(r, 'SEGMENT1') as string;
  return {
    sku,
    name: (r.DESCRIPTION as string) ?? '',
    status: r.INVENTORY_ITEM_STATUS_CODE === 'Active' ? 'active' : 'inactive',
    leadTimeDays: r.FULL_LEAD_TIME === undefined || r.FULL_LEAD_TIME === null ? null : Number(r.FULL_LEAD_TIME),
    listPrice: money(r.LIST_PRICE),
    uom: (r.PRIMARY_UOM_CODE as string) ?? null,
    externalId: String(r.INVENTORY_ITEM_ID ?? ''),
  };
}

export function parseErpStock(raw: unknown): ParsedStock {
  const r = asRecord(raw);
  const warehouseCode = requireField(r, 'SUBINVENTORY_CODE') as string;
  const onHandQty = requireField(r, 'ON_HAND_QTY') as number;
  return {
    sku: (r.SEGMENT1 as string) ?? null,
    externalItemId: r.INVENTORY_ITEM_ID === undefined || r.INVENTORY_ITEM_ID === null ? null : String(r.INVENTORY_ITEM_ID),
    warehouseCode,
    quantity: Number(onHandQty),
  };
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim().toLowerCase();
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

export function parseErpCustomer(raw: unknown): ParsedCustomer {
  const r = asRecord(raw);
  const code = requireField(r, 'ACCOUNT_NUMBER') as string;
  const name = requireField(r, 'PARTY_NAME') as string;
  return {
    code,
    name,
    email: normalizeEmail(r.EMAIL_ADDRESS),
    phone: normalizePhone(r.PHONE_NUMBER),
    taxId: (r.TAX_REFERENCE as string) ?? null,
    externalId: String(r.CUST_ACCOUNT_ID ?? ''),
  };
}

function requireNumericField(raw: Record<string, unknown>, field: string, context: string): number {
  const value = raw[field];
  const num = Number(value);
  if (value === undefined || value === null || value === '' || Number.isNaN(num)) {
    throw new Error(`${context}: missing/non-numeric field ${field}`);
  }
  return num;
}

/**
 * Per-line defensive validation (T8 review follow-up): a sale order with a
 * malformed line must fail loudly and name the offending field, rather than
 * silently coercing to NaN/undefined and corrupting downstream order totals.
 */
function parseErpSaleOrderLine(line: Record<string, unknown>, index: number): { sku: string; qty: number; unitPrice: string } {
  const context = `ERP sale order line ${index}`;
  const sku = requireField(line, 'SEGMENT1') as string;
  const qty = requireNumericField(line, 'ORDERED_QUANTITY', context);
  const unitPrice = money(requireNumericField(line, 'UNIT_SELLING_PRICE', context)) as string;
  return { sku, qty, unitPrice };
}

export function parseErpSaleOrder(raw: unknown): ParsedSaleOrder {
  const r = asRecord(raw);
  const orderNumber = requireField(r, 'ORDER_NUMBER') as string;
  const rawLines = Array.isArray(r.LINES) ? (r.LINES as Record<string, unknown>[]) : [];
  return {
    orderNumber,
    orderedDate: (r.ORDERED_DATE as string) ?? null,
    soldToAccount: (r.SOLD_TO_ACCOUNT as string) ?? null,
    lines: rawLines.map((line, index) => parseErpSaleOrderLine(line, index)),
  };
}
