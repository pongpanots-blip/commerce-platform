import { BadRequestException } from '@nestjs/common';

/**
 * Stage 4d: the ERP-fed product fields commerce owns, with josh's pending-patch keys (= product_inventory columns;
 * category as the ERP's `category_code`). Price / MOQ are stage 4a's, names stage 4b's.
 */
export const MASTER_KEYS = [
  'order_taking_flag', 'sup_code', 'selling_unit', 'order_taking_unit', 'erp_ordering_units', 'pack_size', 'packaging_type',
  'units_per_box', 'weight_per_unit', 'brand_name', 'vat_type', 'marketed_by', 'product_type', 'season_start', 'season_end',
  'product_status', 'category_code',
] as const;

type ErpItem = Record<string, unknown>;
const str = (v: unknown) => (v == null ? undefined : String(v));

/** josh mapErpVatToVatType: '1' → 7%, anything else non-empty → 0%. */
function vatType(vat: unknown): string | null {
  const t = vat == null ? '' : String(vat).trim();
  return t === '' ? null : t === '1' ? '7%' : '0%';
}

/** josh normalizeErpOrderingUnits. */
function orderingUnits(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null;
  const codes = options
    .map((o) => (typeof o === 'string' ? o : typeof (o as { UNIT_CODE?: unknown } | null)?.UNIT_CODE === 'string' ? (o as { UNIT_CODE: string }).UNIT_CODE : null))
    .map((c) => c?.trim().toUpperCase() ?? '')
    .filter((c) => c.length > 0);
  return [...new Set(codes)];
}

/** josh mapErpProductStatusToJosh / mapErpIsEnableToJosh / resolveErpProductStatus. */
function lifecycle(status: unknown): 'active' | 'inactive' | null {
  const t = status == null ? '' : String(status).trim();
  if (!t) return null;
  const u = t.toUpperCase();
  if (['N', 'ACTIVE', '1'].includes(u)) return 'active';
  if (['Z', 'D', 'CANCELLED', 'CANCELED', 'DISCONTINUE', 'INACTIVE', '0', '2'].includes(u)) return 'inactive';
  return null;
}
function productStatus(item: ErpItem): 'active' | 'inactive' | null {
  const life = lifecycle(item.PRODUCT_STATUS) ?? lifecycle(item.STATUS);
  const en = item.IS_ENABLE == null || String(item.IS_ENABLE).trim() === '' ? null : String(item.IS_ENABLE).trim() === '1' ? 'active' : 'inactive';
  if (life == null) return en;
  if (en == null) return life;
  return life === 'active' && en === 'active' ? 'active' : 'inactive';
}

/** One ERP product upsert item → josh's pending patch (buildProductUpsertPendingPatch), master keys only. */
export function buildMasterPatch(item: ErpItem): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (item.ORDER_TAKING != null) p.order_taking_flag = str(item.ORDER_TAKING);
  if (item.SUP_CODE != null) p.sup_code = String(item.SUP_CODE).trim() || null;
  if (item.SELLING_UNIT != null) p.selling_unit = str(item.SELLING_UNIT);
  if (item.ORDER_TAKING_UNIT != null) p.order_taking_unit = str(item.ORDER_TAKING_UNIT);
  const units = orderingUnits(item.ORDERING_OPTIONS);
  if (units != null) p.erp_ordering_units = units;
  if (item.PACK_SIZE != null && item.PACK_SIZE !== '') p.pack_size = String(item.PACK_SIZE).trim();
  else if (item.PACK_SIZE === '') p.pack_size = null;
  if (item.PACKAGE_TYPE != null) p.packaging_type = str(item.PACKAGE_TYPE);
  if (item.UNIT_PER_BOX != null) p.units_per_box = String(item.UNIT_PER_BOX);
  if (item.WEIGHT_PER_UNIT != null) p.weight_per_unit = str(item.WEIGHT_PER_UNIT);
  if (item.BRAND_NAME != null) p.brand_name = str(item.BRAND_NAME);
  if (item.VAT != null) p.vat_type = vatType(item.VAT);
  if (item.MARKETED_BY != null) p.marketed_by = String(item.MARKETED_BY).trim() || null;
  if (item.PRODUCT_TYPE != null) p.product_type = str(item.PRODUCT_TYPE);
  if (item.SEASON_START) p.season_start = str(item.SEASON_START);
  if (item.SEASON_END) p.season_end = str(item.SEASON_END);
  const status = productStatus(item);
  if (status != null) p.product_status = status;
  if (item.GROUP_CODE != null) p.category_code = str(item.GROUP_CODE);
  return p;
}

/** The product form's master keys (staff edit). `category_id` is turned into `category_code` by the caller. */
const FORM: Record<string, 'text' | 'status' | 'vat' | 'flag'> = {
  product_status: 'status', brand_name: 'text', selling_unit: 'text', pack_size: 'text', order_taking_unit: 'text',
  packaging_type: 'text', units_per_box: 'text', weight_per_unit: 'text', marketed_by: 'text', product_type: 'text',
  vat_type: 'vat', order_taking_flag: 'flag',
};

export function splitMaster(body: Record<string, unknown>): { master: Record<string, unknown>; categoryId?: string | null; rest: Record<string, unknown> } {
  const master: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  let categoryId: string | null | undefined;
  for (const [k, v] of Object.entries(body)) {
    if (k === 'category_id') { categoryId = v == null || v === '' ? null : String(v); continue; }
    const kind = FORM[k];
    if (!kind) { rest[k] = v; continue; }
    const bad = (why: string) => new BadRequestException(`${k}: ${why}`);
    if (v != null && typeof v !== 'string' && typeof v !== 'number') throw bad('ต้องเป็นข้อความ');
    const s = v == null ? '' : String(v).trim();
    if (kind === 'status' && !['active', 'inactive', 'draft'].includes(s)) throw bad('active / inactive / draft');
    if (kind === 'vat' && !['0%', '7%'].includes(s)) throw bad('0% / 7%');
    if (kind === 'flag' && !['Y', 'N'].includes(s)) throw bad('Y / N');
    if (s.length > 255) throw bad('ยาวเกิน 255 ตัวอักษร');
    master[k] = s || null;
  }
  return { master, ...(categoryId !== undefined ? { categoryId } : {}), rest };
}

/** josh's live products → the same `fields` commerce stores (drafts stay josh's). Import and parity read it. */
export const JOSH_MASTER_SQL = `SELECT p.product_inventory_sku AS sku, jsonb_build_object(
    ${MASTER_KEYS.filter((k) => k !== 'category_code').map((k) => `'${k}', p.${k}`).join(', ')}, 'category_code', c.category_code) AS fields
  FROM product_inventory p LEFT JOIN product_category c ON c.id = p.category_id
  WHERE p.product_status IS DISTINCT FROM 'draft'`;
