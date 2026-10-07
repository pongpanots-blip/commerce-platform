# ขั้น 4a — สลับราคาสินค้าให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-08-stage4a-prices.md` · spec §4.2 แถว 4 (กลุ่มแรก)

ทำโดย ops · ราคาที่ย้าย: ราคาขาย (`selling_unit_price`), ราคาต่อหน่วยสั่งของ ERP (`ordering_price`), MOQ และคิว MER ที่อนุมัติ
ราคา/MOQ จาก ERP · ราคาลูกค้า/สัญญาอยู่ commerce แล้ว (staff prices) · โปรโมชัน/คูปอง, ราคาขีดฆ่า (`original_price`)
และต้นทุน (`buying_price`) ยังอยู่ josh

## ก่อน shadow

1. merge + deploy commerce (migration `1794700000000-ProductPrices`) และ josh (`feat/commerce-owns-prices`) — flag ปิดทั้งหมด
2. `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- prices` แล้ว `npm run price-parity` → `different: 0, missing: 0`

## Shadow ~1 สัปดาห์

3. ทุกวัน: import อีกรอบแล้ว `npm run price-parity` — ต้องตรง 100% (ยังแก้ราคาที่ josh ตามปกติ)
4. ทีม MER ลองดูหน้า commerce-admin → ราคาสินค้า (ดูได้ ปุ่มอนุมัติ/แก้ยังกดไม่ได้จนกว่าจะสลับ)

## วันสลับ

5. แจ้ง MER / CS ว่าหยุดแก้และอนุมัติราคา ~15 นาที
6. ใน josh admin อนุมัติหรือไม่อนุมัติคิว ERP ที่ค้างให้หมดก่อน (หรือปล่อยไว้ — ข้อ 7 ดึงส่วนราคา/MOQ ไปเข้าคิวของ commerce)
7. `npm run import-from-josh -- prices` รอบสุดท้าย แล้ว `npm run price-parity` = ตรงทั้งหมด
8. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `product.price.snapshot` · **เอาออก** `product.price.changed`
   และ `product.moq.changed`
9. josh: `COMMERCE_OWNS_PRICES=true` แล้ว restart
   - ราคา/MOQ จาก ERP ของสินค้าที่ขายอยู่ ไม่ถูกพักในคิวของ josh อีก (ไปคิวของ commerce)
   - แก้ราคาขายในฟอร์มสินค้า josh → 403 · อนุมัติคำขอราคาของ CS → 403 (ตั้งราคาลูกค้าที่ commerce)
   - คิว ERP เดิมของ josh: อนุมัติแล้วใช้เฉพาะส่วนที่ไม่ใช่ราคา/MOQ
10. commerce: `COMMERCE_OWNS_PRICES=true` แล้ว restart
11. ทดสอบ: แก้ราคาขาย SKU ทดสอบในหน้า ราคาสินค้า → josh `product_inventory.selling_unit_price` เปลี่ยน, `original_price` ถูกปรับ,
    หน้าสินค้า/ตะกร้าเห็นราคาใหม่ทันที · ERP ส่งราคา SKU ทดสอบ → ขึ้นในคิวของ commerce → อนุมัติ → josh เปลี่ยน
12. `npm run price-parity` อีกครั้ง → ตรงทั้งหมด

## Rollback

- josh: เอา `COMMERCE_OWNS_PRICES` ออก แล้ว restart → josh กลับมาพัก/อนุมัติราคา ERP เองตามเดิม
- commerce: `COMMERCE_OWNS_PRICES=false` · subscription: เอา `product.price.snapshot` ออก, ใส่ `product.price.changed` /
  `product.moq.changed` คืน
- ราคาที่แก้ใน commerce ระหว่างนั้นอยู่ใน josh แล้ว — ไม่มีอะไรหาย · คิวที่ค้างใน commerce ให้ ERP ส่งซ้ำ หรืออนุมัติใน josh

## ข้อจำกัด

- ERP ยิงราคาเข้า josh ตรง (ตอน commerce ล่ม) → josh ส่งต่อเป็น `erp.fallback.received` → commerce เข้าคิวเมื่อเปิด
  `CRON_ERP_FALLBACK_REPLAY_ENABLED` (ขั้น 3)
- สินค้า draft ของ josh ยังรับราคา ERP ตรง (ยังขายไม่ได้จนกว่าจะอนุมัติ) — ราคาครั้งแรกหลังอนุมัติมาจาก commerce
