/**
 * โมดูลใน `@josh/shared-api` ที่ไม่พึ่ง `api-client.ts` (ตัวนั้นใช้ `import.meta` จึงโหลด
 * ไม่ได้ภายใต้ ts-jest `module: commonjs`)
 *
 * jest ของ shop-web map ทั้ง specifier `@josh/shared-api` มาที่ไฟล์นี้ — ถ้า spec ของ
 * shop-web ต้องใช้ของจาก lib เพิ่ม ให้ re-export ที่นี่ ไม่งั้น import จะได้ `undefined`
 * เงียบ ๆ (ดู apps/shop-web/jest.config.ts)
 */
export * from './lib/marketing-workflow/marketing-creative.schema';
export * from './lib/product-category/category-order';
export * from './lib/coupon/coupon-time';
export * from './lib/filter-groups/filter-groups.api';
