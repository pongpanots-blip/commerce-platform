# ขั้น 4b — สลับเนื้อหาสินค้าให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-08-stage4b-product-content.md` · spec §4.2 แถว 4 (กลุ่ม ตัวตน/เนื้อหา/หน่วย)

ทำโดย ops · ที่ย้าย: ชื่อและรายละเอียด (ไทย/อังกฤษ), ส่วนผสม, สารก่อภูมิแพ้, ข้อมูลวันหมดอายุ, วิธีใช้, เข้ากับอาหาร,
อุณหภูมิเก็บ, อายุสินค้าสูงสุด, ออร์แกนิก, รหัสย่อ, ต้นทุน (`buying_price`), จุดเตือนใกล้หมด และจำนวนสั่งเติม — ช่องที่มีแต่
พนักงานแก้ · **ยังอยู่ josh:** ช่องที่ ERP/Jagota ส่งมาด้วย (หน่วย, ขนาดแพ็ก, แบรนด์, VAT, ประเภท, สถานะ, หมวด, การสั่งซื้อ,
วิธีเก็บ, ใบรับรอง) — ย้ายพร้อมคิว ERP ของสินค้าในขั้นถัดไป · โภชนาการ (`nutrition`), ราคาตั้ง (`original_price`), รูปภาพ

ต้องทำขั้น 4a ก่อน (branch นี้ต่อจาก 4a) และ josh ต้องเปิด `COMMERCE_ACTIONS_ENABLED` (ฟอร์มสินค้า relay ไป josh อยู่แล้ว)

## ก่อน shadow

1. merge + deploy commerce (migration `1794800000000-ProductContents`) และ josh (`feat/commerce-owns-content`) — flag ปิดทั้งหมด
2. `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- contents` แล้ว `npm run content-parity` → `different: 0, missingInJosh: 0`

## Shadow ~1 สัปดาห์

3. ทุกวัน: import อีกรอบแล้ว `npm run content-parity` — ต้องตรง 100% (ยังแก้ที่ josh หรือฟอร์มของ commerce-admin ที่ relay ไป josh)

## วันสลับ

4. แจ้งทีมที่แก้ข้อมูลสินค้าให้หยุดแก้ ~15 นาที
5. `npm run import-from-josh -- contents` รอบสุดท้าย แล้ว `npm run content-parity` = ตรงทั้งหมด
6. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `product.content.snapshot`
7. josh: `COMMERCE_OWNS_CATALOG=true` แล้ว restart (ถ้ายังไม่เปิด) — ฟอร์มสินค้าของ josh แก้ข้อมูลไม่ได้ (403, รูปยังแก้ได้),
   อัปโหลด sheet สินค้า (`POST /product-category/upload`) → 403, รับ `product.content.snapshot`
8. commerce: `COMMERCE_OWNS_PRODUCT_CONTENT=true` แล้ว restart
9. ทดสอบ: commerce-admin → สินค้า (josh) → SKU ทดสอบ → แก้ข้อมูลสินค้า → แก้ส่วนผสม + ชื่อไทย → บันทึก → josh
   `product_inventory.ingredients` และ `product_translation` (th) เปลี่ยน, หน้าสินค้า/ค้นหาเห็นชื่อใหม่ · ช่องหน่วย/แบรนด์ในฟอร์ม
   เดียวกันยังไป josh ตามเดิม
10. `npm run content-parity` อีกครั้ง → ตรงทั้งหมด (`joshOnly` = สินค้า draft ใหม่จาก ERP ที่ยังไม่เคยแก้ใน commerce — ปกติ)

## Rollback

- commerce: `COMMERCE_OWNS_PRODUCT_CONTENT=false` → ฟอร์มส่งทุกช่องไป josh ผ่าน relay ตามเดิม · subscription: เอา
  `product.content.snapshot` ออก
- josh ไม่ต้องเปลี่ยน (`COMMERCE_OWNS_CATALOG` เป็นของ relay อยู่แล้ว) — ค่าที่แก้ใน commerce ระหว่างนั้นอยู่ใน josh แล้ว
- เปิดกลับ: import `contents` ใหม่ก่อน (ค่าที่แก้ผ่าน relay ระหว่างปิดจะได้ไม่ถูกทับ)

## ข้อจำกัด

- สินค้าใหม่จาก ERP (draft) ได้ชื่อจาก ERP ที่ josh — commerce ยังไม่มีแถวจนกว่าจะแก้ครั้งแรก (ฟอร์มแสดงค่าของ josh)
- ช่องว่างในฟอร์ม: ช่องเนื้อหา = ล้างค่า (ยกเว้นชื่อ — ห้ามว่าง) · ช่องอื่นที่ไป josh = ไม่ลบค่าเดิม (ฟอร์มบอกไว้)
