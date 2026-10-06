/**
 * ลำดับหมวดหมู่ที่ deterministic — เรียงตาม `category_code` แบบตัวเลข
 *
 * `sort` เป็นลำดับ "ในกลุ่มพี่น้องใต้แม่เดียวกัน" หมวด Level 1 ที่มาจากคนละ Division จึงมี
 * `sort` ซ้ำกันได้ตามปกติ (ข้อมูลจริง: BAKERY / BEVERAGE & ALCOHOL / DRY GOODS ต่างก็
 * `sort = 1`) การเรียงด้วย `sort` อย่างเดียวจึงได้ลำดับที่ tie แล้วแล้วแต่ DB คืนมา —
 * ลำดับหน้าแรกสลับเองได้โดยที่ admin ไม่ได้แตะอะไร
 *
 * `category_code` (`{parent.category_code}-{sort}`) ฝังทั้งแม่และลำดับไว้แล้ว เทียบทีละ
 * segment แบบตัวเลขจึงได้ "จัดกลุ่มตามแม่ แล้วเรียงตาม sort" ในตัวเดียว และไม่พลาดตอนมี
 * พี่น้องเกิน 9 ตัวแบบการเทียบสตริงตรง ๆ (`1-10` ต้องมาหลัง `1-2`)
 */
export type CategoryOrderRow = {
  category_code?: string | null;
  sort_order?: number | null;
  category_name_en?: string | null;
};

/** `'2-1'` → `[2, 1]` · ว่างหรือมี segment ที่ไม่ใช่ตัวเลข → `null` (ให้ fallback ทำงาน) */
function codeSegments(code?: string | null): number[] | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  const segments = trimmed.split('-').map(Number);
  return segments.every(Number.isFinite) ? segments : null;
}

export function compareCategoryOrder(
  a: CategoryOrderRow,
  b: CategoryOrderRow,
): number {
  const left = codeSegments(a.category_code);
  const right = codeSegments(b.category_code);

  if (left && right) {
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const diff = (left[i] ?? -1) - (right[i] ?? -1);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  // ไม่มี code (หมวดที่เพิ่งสร้างก่อน rebuild) — ใช้ sort แล้วค่อยชื่อกันลำดับสุ่ม
  const bySort = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (bySort !== 0) return bySort;
  return (a.category_name_en ?? '').localeCompare(b.category_name_en ?? '');
}

/**
 * ลำดับของหมวด **Level 1** — ชั้นที่หน้าแรกของ shop แสดงทั้งชั้นต่อกันเป็นแถวเดียว
 *
 * ชั้นนี้ (ชั้นเดียว) ใช้ `sort` เป็น **เลขรันสากล 1..N ข้าม Division** ไม่ใช่ลำดับในกลุ่มพี่น้อง
 * เพราะลูกค้าไม่เห็น Division เลย เห็นแต่แถวไอคอนแถวเดียว — admin จัดลำดับผ่าน
 * `PUT /product-category/level1-order` ซึ่งเขียน `sort` เป็น 1..N ให้ทั้งชั้น
 * (`compareCategoryOrder` ใช้ไม่ได้ที่นี่ เพราะมันเทียบ `category_code` ทีละ segment ผลคือ
 * จัดกลุ่มตาม Division เสมอ ลำดับที่ admin ตั้งข้าม Division จะถูกกลืนหาย)
 *
 * **tie-break สำคัญ** — ข้อมูล seed ที่ยังไม่เคยถูกจัดลำดับมี `sort` ซ้ำกันข้าม Division
 * (BAKERY, BEVERAGE & ALCOHOL, DRY GOODS ต่างก็ `sort = 1`) เทียบด้วย `sort` อย่างเดียวจึงได้
 * ลำดับที่แล้วแต่ DB คืนมา ตกไปที่ `compareCategoryOrder` ต่อ ลำดับก่อนจัดครั้งแรกจึงยัง
 * deterministic (จัดกลุ่มตาม Division เหมือนเดิม) และเปลี่ยนเป็นลำดับที่ admin ตั้งทันทีที่จัดครั้งแรก
 */
export function compareLevel1Order(a: CategoryOrderRow, b: CategoryOrderRow): number {
  const bySort = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return bySort !== 0 ? bySort : compareCategoryOrder(a, b);
}
