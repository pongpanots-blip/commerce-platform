import { compareCategoryOrder, compareLevel1Order } from '@josh/shared-api';
import type { CategoryRow } from './category-form';

/**
 * ตัวช่วยของหน้า `/admin/categories` ที่เดินต้นไม้หมวดหมู่ทีละชั้น
 *
 * หน้านี้ไล่เข้าไปทีละหมวด (drill-in) ไม่ใช่กางทั้งต้นไม้ เพราะ **การจัดลำดับมีความหมาย
 * เฉพาะในกลุ่มพี่น้องใต้แม่เดียวกัน** (`sort` เป็นเลขท้ายของ `category_code`) หน้าจอจึงโชว์
 * "ลูกของหมวดหนึ่งตัว" ต่อครั้ง — ตรงกับสิ่งที่ `PUT /product-category/:id/children-order`
 * รับพอดี และเลี่ยงข้อจำกัดของ `@hello-pangea/dnd` ที่ซ้อน Droppable ไม่ได้
 */

/** ลูกทั้งหมดของหมวดแม่ตัวหนึ่ง เรียงแบบเดียวกับที่หน้าร้านเรียง · `null` = Division ชั้นบนสุด */
export function childrenOf(rows: CategoryRow[], parentId: string | null): CategoryRow[] {
  return rows
    .filter((row) => (row.parent_id_uuid ?? null) === parentId)
    .sort(compareCategoryOrder);
}

/** หมวดแม่ไล่จากบนสุดลงมาถึงตัวมันเอง — ใช้ทำ breadcrumb · กันข้อมูลวนลูปด้วยตัวนับ */
export function ancestorTrail(rows: CategoryRow[], id: string | null): CategoryRow[] {
  const byId = new Map(rows.map((row) => [row.category_id_uuid, row]));
  const trail: CategoryRow[] = [];
  let cursor = id;
  while (cursor && trail.length <= rows.length) {
    const node = byId.get(cursor);
    if (!node) break;
    trail.unshift(node);
    cursor = node.parent_id_uuid ?? null;
  }
  return trail;
}

/** ย้ายสมาชิกหนึ่งตัวไปตำแหน่งใหม่ (ผลลัพธ์ของการลากวาง) — คืนอาเรย์ใหม่เสมอ */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** ค้นทั้งต้นไม้ — ชื่อ EN/TH, path, รหัส, หรือ uuid (วางทั้ง id มาค้นได้เลย) */
export function searchCategories(rows: CategoryRow[], keyword: string): CategoryRow[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [];
  return rows
    .filter((row) =>
      [
        row.category_name_en,
        row.category_name_th,
        row.category_path,
        row.category_code,
        row.cat_code,
        row.category_id_uuid,
      ].some((field) => field?.toLowerCase().includes(needle)),
    )
    .sort(compareCategoryOrder);
}

/**
 * ลำดับเปลี่ยนไปจากที่โหลดมาหรือยัง — ใช้เปิด/ปิดปุ่มบันทึก
 * Generic ตาม id — ใช้ได้กับลิสต์ลากจัดลำดับอื่นนอกจากหมวดหมู่ (เช่น cuisine cards) ด้วย
 */
export function orderChanged<T>(original: T[], next: T[], getId: (item: T) => string): boolean {
  if (original.length !== next.length) return true;
  return original.some((item, index) => getId(item) !== getId(next[index]));
}

/**
 * มุมมอง "Home category" — หมวด Level 1 **ทั้งชั้น** เป็นลิสต์เดียว
 *
 * หน้าแรกของ shop ดึง `level=1` ทั้งชั้นมาต่อกันเป็นแถวเดียว ลูกค้าไม่เคยเห็น Level 0 —
 * admin เท่านั้นที่เห็น ชั้นนี้จึงเรียงเป็น **ลำดับเดียวข้าม Division** (`sort` = 1..N สากล ดู
 * `compareLevel1Order` ใน shared-api) ไม่ใช่ลำดับในกลุ่มพี่น้องแบบชั้นอื่น
 *
 * แต่ละแถวยังบอกว่ามาจาก Division ไหน (`parent`) เพราะ admin ต้องรู้ ทั้งที่มันไม่ได้จัดกลุ่ม
 * การแสดงผลอีกต่อไป
 */
export type Level1Row = { row: CategoryRow; parent: CategoryRow | null };

export function level1Rows(rows: CategoryRow[]): Level1Row[] {
  const byId = new Map(rows.map((row) => [row.category_id_uuid, row]));
  return rows
    .filter((row) => (row.category_level ?? -1) === 1)
    .sort(compareLevel1Order)
    .map((row) => ({
      row,
      parent: (row.parent_id_uuid && byId.get(row.parent_id_uuid)) || null,
    }));
}
