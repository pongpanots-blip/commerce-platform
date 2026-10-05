import type { ShopCuisineCardAdmin } from '@josh/shared-api';

/** คีย์เดียวของลิสต์การ์ด cuisine — list/edit ใช้ร่วมกันเพื่อ invalidate หลังบันทึก/จัดลำดับ */
export const CUISINE_CARDS_QUERY_KEY = ['cuisine-cards', 'admin'] as const;

/** "Thai Restaurant" → "thai" */
export function slugFromEnglishName(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  const withoutSuffix = base
    .replace(/-(?:restaurant|cuisine|food)$/g, '')
    .replace(/^-+|-+$/g, '');

  return (withoutSuffix || base).slice(0, 64).replace(/-+$/g, '');
}

/**
 * ใช้ตอนพิมพ์ในช่อง slug สด ๆ — แค่ lowercase + เว้นวรรค→ขีด ไม่ trim ปลายคำ
 * `slugFromEnglishName` เต็มรูปแบบ trim() ก่อนแทนที่ ทำให้เคาะวรรคระหว่างพิมพ์คำถัดไปหายไป
 * ("korean bbq" → "koreanbbq" เพราะช่องว่างท้ายค่าถูก trim ทิ้งทุกครั้งที่พิมพ์ตัวถัดไป) —
 * ใช้ตัวนี้ตอน onChange แล้วค่อยรัน slugFromEnglishName เต็มรูปแบบตอน onBlur/submit
 */
export function looseSlugify(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-');
}

/** ค้นหาการ์ด cuisine — title_th / title_en / slug / id, substring แบบไม่สนตัวพิมพ์ */
export function searchCuisineCards(
  cards: ShopCuisineCardAdmin[],
  keyword: string,
): ShopCuisineCardAdmin[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [];
  return cards.filter((card) =>
    [card.title_th, card.title_en, card.slug, card.id].some((field) =>
      field?.toLowerCase().includes(needle),
    ),
  );
}
