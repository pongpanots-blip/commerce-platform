# ขั้น 4c — สลับหมวดหมู่และชื่อแบรนด์ให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-08-stage4c-categories-brands.md` · spec §2.4 และ §4.2 แถว 4 (กลุ่ม หมวดหมู่/แบรนด์)

ทำโดย ops · ที่ย้าย: ต้นไม้หมวดหมู่ (สร้าง, แก้ชื่อ/รูป/การแสดงหน้าแรก/การเรียง, จัดลำดับ Level 1 และหมวดย่อย, ลบ) และชื่อแบรนด์
(ไทย/อังกฤษ) · **ยังอยู่ josh:** สินค้าตัวไหนอยู่หมวด/แบรนด์ไหน (ERP ส่งมา — ย้ายพร้อมคิว ERP ของสินค้า), หมวด ↔ cuisine,
อัปโหลด sheet (403 อยู่แล้วเมื่อเปิด `COMMERCE_OWNS_CATALOG`)

ต้องทำขั้น 4b ก่อน (branch นี้ต่อจาก 4b)

## ก่อน shadow

1. merge + deploy commerce (migration `1794900000000-ProductCategoriesBrands`) และ josh (`feat/commerce-owns-categories`) — flag ปิดทั้งหมด
2. `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- categories` แล้ว `npm run category-parity` → ทุกตัวเลข 0

## Shadow ~1 สัปดาห์

3. ทุกวัน: import อีกรอบ (แทนทั้งชุด) แล้ว `npm run category-parity` — ต้องเป็น 0 (ยังแก้หมวด/แบรนด์ที่ josh ตามปกติ)

## วันสลับ

4. แจ้งทีมที่แก้หมวด/แบรนด์ให้หยุดแก้ ~15 นาที
5. `npm run import-from-josh -- categories` รอบสุดท้าย แล้ว `npm run category-parity` = 0
6. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `category.tree.snapshot` และ `brand.snapshot`
7. josh: `COMMERCE_OWNS_CATEGORIES=true` แล้ว restart — หน้าหมวด/แบรนด์ของ josh แก้ไม่ได้ (403), รับ snapshot
8. commerce: `COMMERCE_OWNS_CATEGORIES=true` แล้ว restart — หน้าหมวดหมู่/แบรนด์ใน commerce-admin (หน้า josh ที่ฝังไว้) ส่งการแก้มา commerce
9. ทดสอบ: แก้ชื่อไทยของหมวดทดสอบ → josh `product_category` เปลี่ยน, หน้าร้านเห็นชื่อใหม่ · สลับลำดับหมวดย่อยสองตัว → รหัส
   (`category_code`) ใน josh สลับตาม · แก้ชื่อแบรนด์ → josh `brand` เปลี่ยน
10. `npm run category-parity` อีกครั้ง → 0

## Rollback

- ปิด `COMMERCE_OWNS_CATEGORIES` ทั้งสองฝั่ง → josh แก้หมวด/แบรนด์ได้เอง · subscription: เอาสอง event ออก
- ค่าที่แก้ใน commerce ระหว่างนั้นอยู่ใน josh แล้ว · เปิดกลับ: import `categories` ใหม่ก่อน

## ข้อจำกัด

- หน้า admin อ่านหมวด/แบรนด์จาก josh — หลังกดบันทึกแล้วรายการอาจยังเป็นค่าเก่าชั่วครู่ (จน josh รับ snapshot) ให้รีเฟรชอีกครั้ง
- ทุกการแก้หมวดส่งทั้งต้นไม้ (~240 แถว) — ตั้งใจ เพราะการจัดลำดับเปลี่ยนรหัสหลายแถวพร้อมกันและ josh ต้องเขียนใน transaction เดียว
- ลบหมวดใน commerce = ลบใน josh: สินค้าในหมวดนั้นไม่มีหมวด, ลิงก์ cuisine ของหมวดหาย (เหมือนลบที่ josh เอง)
