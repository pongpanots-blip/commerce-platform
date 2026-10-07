import { BadRequestException } from '@nestjs/common';

/** name: required, ≤255 · text: long text · number: varchar(n) · money: numeric(12,2) ≥ 0 · count: int ≥ 0, never null. */
type Kind = 'name' | 'text' | number | 'money' | 'count';

/**
 * Stage 4b: the product content commerce owns — fields only staff write (no ERP / Jagota feed touches them), with
 * josh's names (product_inventory columns; the th / en name and description of product_translation as `*_th` / `*_en`,
 * the keys josh's product form already uses).
 */
export const CONTENT_FIELDS: Record<string, Kind> = {
  product_name_th: 'name', product_name_en: 'name', product_description_th: 'text', product_description_en: 'text',
  ingredients: 'text', allergens: 'text', expiration_info: 'text', usage_direction: 'text', best_paired_food: 'text',
  storage_temperature: 100, maximum_shelf_life: 50, is_organic: 50, product_short_code: 20,
  buying_price: 'money', low_stock_threshold: 'count', reorder_quantity: 'count',
};

const TEXT_MAX = 20000;

function value(key: string, kind: Kind, raw: unknown): unknown {
  const bad = (why: string) => new BadRequestException(`${key}: ${why}`);
  if (kind === 'money' || kind === 'count') {
    if (raw == null || raw === '') {
      if (kind === 'count') throw bad('ต้องเป็นจำนวนเต็มไม่ติดลบ');
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw bad('ต้องเป็นตัวเลขไม่ติดลบ');
    if (kind === 'count' && (!Number.isInteger(n) || n > 2147483647)) throw bad('ต้องเป็นจำนวนเต็มไม่ติดลบ');
    if (kind === 'money' && (Math.abs(Math.round(n * 100) - n * 100) > 1e-6 || n >= 1e10)) throw bad('ทศนิยมไม่เกิน 2 ตำแหน่ง');
    return n;
  }
  if (raw != null && typeof raw !== 'string') throw bad('ต้องเป็นข้อความ');
  const s = ((raw as string | null | undefined) ?? '').trim();
  if (kind === 'name') {
    if (!s) throw bad('ชื่อสินค้าห้ามว่าง');
    if (s.length > 255) throw bad('ยาวเกิน 255 ตัวอักษร');
    return s;
  }
  const max = kind === 'text' ? TEXT_MAX : kind;
  if (s.length > max) throw bad(`ยาวเกิน ${max} ตัวอักษร`);
  return s || null;
}

/** The content keys of a product form / API body, validated; other keys are left to the caller (`rest`). */
export function splitContent(body: Record<string, unknown>): { content: Record<string, unknown>; rest: Record<string, unknown> } {
  const content: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k in CONTENT_FIELDS) content[k] = value(k, CONTENT_FIELDS[k], v);
    else rest[k] = v;
  }
  return { content, rest };
}

/** josh product_inventory (+ th / en translation) → the same `fields` object commerce stores. Import and parity read it. */
export const JOSH_CONTENT_SQL = `SELECT p.product_inventory_sku AS sku, jsonb_build_object(
    'product_name_th', th.product_name, 'product_name_en', en.product_name,
    'product_description_th', th.product_description, 'product_description_en', en.product_description,
    ${Object.keys(CONTENT_FIELDS).filter((k) => !/_(th|en)$/.test(k)).map((k) => `'${k}', p.${k}`).join(', ')}) AS fields
  FROM product_inventory p
  LEFT JOIN product_translation th ON th.product_inventory_id = p.product_inventory_id AND th.language_code = 'th'
  LEFT JOIN product_translation en ON en.product_inventory_id = p.product_inventory_id AND en.language_code = 'en'`;
