import type {
  PromotionProductItem,
  PromotionProductSetInput,
} from '@josh/shared-api';
import type { CategoryRow } from '../category/category-form';
import { buildSaveErrorMessage } from '../carousels/carousel-product.helpers';

/** ต่อ manual ∪ category ∪ brand แล้วตัดซ้ำด้วย productInventoryId — priority manual > category > brand */
export function mergeProductItems(
  manual: PromotionProductItem[],
  category: PromotionProductItem[],
  brand: PromotionProductItem[] = [],
): PromotionProductItem[] {
  const manualIds = new Set(manual.map((item) => item.productInventoryId));
  const categoryOnly = category.filter((item) => !manualIds.has(item.productInventoryId));
  const coveredIds = new Set([...manualIds, ...categoryOnly.map((item) => item.productInventoryId)]);
  const brandOnly = brand.filter((item) => !coveredIds.has(item.productInventoryId));
  return [...manual, ...categoryOnly, ...brandOnly];
}

/** แยกรายการที่โหลดมาจาก detail.items กลับเป็นสาม state (manual / category / brand) ตาม source */
export function splitItemsBySource(items: PromotionProductItem[]): {
  manual: PromotionProductItem[];
  category: PromotionProductItem[];
  brand: PromotionProductItem[];
} {
  return {
    manual: items.filter((item) => item.source === 'manual'),
    category: items.filter((item) => item.source === 'category'),
    brand: items.filter((item) => item.source === 'brand'),
  };
}

/**
 * The product-set backend already puts the offending SKUs in `message` for both
 * `invalid_skus` and `inactive_skus`, so show it as-is — carousel's
 * `buildSaveErrorMessage` appends the list again (its backend message omits it).
 */
export function buildPromotionSaveErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, unknown> } })
    ?.response?.data;
  const hasSkuList =
    (Array.isArray(data?.inactive_skus) && data.inactive_skus.length > 0) ||
    (Array.isArray(data?.invalid_skus) && data.invalid_skus.length > 0);
  if (hasSkuList && typeof data?.message === 'string' && data.message) {
    return data.message;
  }
  return buildSaveErrorMessage(error);
}

export function buildProductSetInput(input: {
  name: string;
  description: string;
  isActive: boolean;
  manualItems: PromotionProductItem[];
  categoryIds: string[];
  brandIds: string[];
}): PromotionProductSetInput {
  return {
    name: input.name.trim(),
    description: input.description.trim() || null,
    isActive: input.isActive,
    skus: input.manualItems.map((item) => item.sku),
    categoryIds: input.categoryIds,
    brandIds: input.brandIds,
  };
}

/**
 * ไฟล์ CSV คอลัมน์เดียว หัวตาราง `sku` — ตัดบรรทัดหัวตาราง, ตัดซ้ำ
 * เอาเฉพาะคอลัมน์แรก (แยกด้วย comma / semicolon / tab) กัน Excel export ที่มี comma
 * ต่อท้ายทุกแถว และขึ้นบรรทัดใหม่รองรับทั้ง CRLF / LF / CR เดี่ยว (Mac เก่า)
 */
export function parseSkuCsv(text: string): string[] {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => (line.split(/[,;\t]/)[0] ?? '').trim().replace(/^"+|"+$/g, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const body = lines[0].toLowerCase() === 'sku' ? lines.slice(1) : lines;
  return Array.from(new Set(body));
}

/**
 * imageUrl จาก resolve-skus / category-products อาจเป็น absolute URL (S3) หรือ relative
 * path (/uploads/...) แล้วแต่ที่มาของ media — ใช้ตรงๆ เมื่อเป็น absolute, prefix ด้วย
 * apiBaseUrl เมื่อเป็น relative (แพทเทิร์นเดียวกับ carousel product panel)
 */
export function resolveProductImageUrl(
  imageUrl: string | null | undefined,
  apiBaseUrl: string,
): string | null {
  if (!imageUrl) return null;
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : `${apiBaseUrl}${imageUrl}`;
}

export const PROMOTION_PRODUCT_SET_CSV_TEMPLATE = 'sku\nSKU001\nSKU002';
export const PROMOTION_PRODUCT_SET_CSV_TEMPLATE_FILENAME =
  'promotion-product-set-template.csv';

/** ดาวน์โหลด template CSV ของ Promotion Product Set (client-only) */
export function downloadPromotionProductSetCsvTemplate(): void {
  // BOM กัน Excel บน Windows อ่านหัวตาราง/ค่าไทยผิด
  const blob = new Blob([`﻿${PROMOTION_PRODUCT_SET_CSV_TEMPLATE}\n`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = PROMOTION_PRODUCT_SET_CSV_TEMPLATE_FILENAME;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// --- หมวดหมู่แบบ multi-select: ติ๊กแม่ครอบลูกทั้งกิ่ง (แนวคิดเดียวกับ CartMoveCategoriesAdmin) ---

export function categoryParentMap(rows: CategoryRow[]): Map<string, string | null> {
  return new Map(rows.map((row) => [row.category_id_uuid, row.parent_id_uuid ?? null]));
}

/** true เมื่อมีบรรพบุรุษอยู่ใน selected แล้ว — ลูกถูกครอบโดยแม่ที่ติ๊กไว้ */
export function isCoveredByAncestor(
  id: string,
  selected: Set<string>,
  parents: Map<string, string | null>,
): boolean {
  let cursor = parents.get(id) ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (selected.has(cursor)) return true;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return false;
}

export function categoryDescendantIds(rows: CategoryRow[], rootId: string): string[] {
  const kids = rows.filter((row) => (row.parent_id_uuid ?? null) === rootId);
  const out: string[] = [];
  for (const kid of kids) {
    out.push(kid.category_id_uuid);
    out.push(...categoryDescendantIds(rows, kid.category_id_uuid));
  }
  return out;
}

/** ติ๊ก/ยกเลิกหมวดหนึ่งตัว — ติ๊กแม่ลบลูกที่เคยติ๊กแยกไว้ทั้งกิ่ง, ลูกที่ถูกแม่ครอบอยู่แล้วสั่งติ๊กเองไม่ได้ */
export function toggleCategoryId(
  rows: CategoryRow[],
  selected: Set<string>,
  id: string,
  parents: Map<string, string | null>,
): Set<string> {
  if (isCoveredByAncestor(id, selected, parents)) return selected;
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  for (const desc of categoryDescendantIds(rows, id)) {
    next.delete(desc);
  }
  return next;
}
