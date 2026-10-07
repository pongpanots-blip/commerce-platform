# ขั้น 4f — สลับรอบสั่งซื้อ supplier และข้อมูลโลจิสติกส์ของสินค้าให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-08-stage4f-ordering-logistics.md` · spec §2.4 และ §4.2 แถว 4 (การสั่งซื้อ / โลจิสติกส์)

ทำโดย ops · ที่ย้าย:
- **รอบสั่งซื้อ supplier** (`supplier_order_period` — ERP `PUT /erp/order-periods`: สินค้าสั่งล่วงหน้ารับวันส่งไหน ปิดรับเมื่อไร)
  josh ใช้ตรวจตอน checkout และแสดงรอบที่เปิดใน PDP / ตะกร้า
- **โลจิสติกส์ของสินค้า** — `unit_ratio`, `sub_packing_unit`, `product_unit`, `expected_restock_at`, `delivery_dates` (วันที่ส่งได้)

**ยังอยู่ josh:** ปฏิทินวันส่งต่อ SKU (`sku_order_period`) และปฏิทินบริษัท (`delivery_calendar`) — josh ดึงจาก Jagota Node API
(cron / `/erp/*/probe`) เป็น cache ไม่ใช่ข้อมูลที่มีคนแก้ · `order_taking_flag` / ฤดู / `sup_code` เป็นของ 4d · MOQ ของ 4a

## ⚠️ ต้องมีก่อน

- **josh `feat/commerce-owns-ordering` (ยังไม่ได้ทำ)** — flag `COMMERCE_OWNS_ORDERING`, handler `supplier.order_periods.snapshot` /
  `product.logistics.snapshot`, กันการเขียนของ josh เอง (ดู Task 1 ในแผน) · **ห้ามเปิด flag ฝั่ง commerce ก่อน josh พร้อม**
  (ถ้า subscription มี event ใหม่แต่ josh ยังไม่รู้จัก → dead-letter)
- ขั้น 4d สลับแล้ว (ฟอร์มสินค้าแยก key ตามลำดับ ราคา → เนื้อหา → ERP master → โลจิสติกส์)

## ก่อน shadow

1. merge + deploy commerce (migration `1795150000000-OrderingLogistics`) และ josh — flag ปิดทั้งหมด
2. `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- ordering` แล้ว `npm run ordering-parity`
   → `rounds.different / notInJosh / notInCommerce: 0`, `logistics.different: 0, notInJosh: 0`

## Shadow ~1 สัปดาห์

3. ทุกวัน: import `ordering` อีกรอบแล้ว `ordering-parity` — ต้องตรง (josh ยังรับ ERP push / poll และแก้เองตามปกติ)
   · ระหว่างนี้ commerce ยัง relay `erp.order_periods.pushed` ตามเดิม แต่ไม่เขียนตารางของตัวเอง (flag ปิด)

## วันสลับ

4. แจ้งทีมสินค้าให้หยุดแก้ หน่วย/วันของเข้า/วันส่ง ในฟอร์มสินค้า ~15 นาที
5. `npm run import-from-josh -- ordering` รอบสุดท้าย แล้ว `npm run ordering-parity` = ตรง
6. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `supplier.order_periods.snapshot`, `product.logistics.snapshot`
7. josh: `COMMERCE_OWNS_ORDERING=true` แล้ว restart — ERP `order-periods` ตอบ 200 แต่ไม่เขียน (ส่งต่อเป็น `erp.fallback.received`),
   poll cron ส่งต่อแทนเขียน, ฟอร์ม/relay ที่แก้ 5 ช่องนี้ → 403, Jagota sync ไม่ทับ `unit_ratio`
8. commerce: `COMMERCE_OWNS_ORDERING=true` แล้ว restart · ถ้ายังไม่เปิด ให้เปิด `CRON_ERP_FALLBACK_REPLAY_ENABLED=true` ด้วย
   (รอบที่ josh รับแทนหรือ poll ได้ จะมาถึง commerce ทางนี้)
9. ทดสอบ:
   - ERP (หรือ simulator ของ commerce) `PUT /erp/order-periods` ของ supplier ทดสอบ → commerce-admin → รอบสั่งซื้อ supplier เห็นรอบใหม่ /
     รอบที่ไม่อยู่ใน push เป็น "ปิด" → josh `supplier_order_period` ตรงกัน → PDP ของ SKU สั่งล่วงหน้าของ supplier นั้นเห็นรอบที่เปิด
   - ฟอร์มสินค้า: แก้ "วันที่ส่งได้" เป็น `MONDAY,THURSDAY` และ "คาดว่าของเข้า" → josh `product_inventory` เปลี่ยน
10. `npm run ordering-parity` อีกครั้ง → ตรง (`joshOnly` = สินค้าที่สร้างใหม่หลัง import — ปกติ)

## Rollback

- ปิด `COMMERCE_OWNS_ORDERING` ทั้งสองฝั่ง → josh รับ ERP push / poll และแก้ฟอร์มเองตามเดิม · subscription: เอา 2 event ออก
- ค่าที่แก้ใน commerce อยู่ใน josh แล้ว · รอบที่ ERP ส่งระหว่างนั้นอยู่ใน josh แล้วเช่นกัน (snapshot) · เปิดกลับ: import `ordering` ใหม่ก่อน

## ข้อจำกัด

- snapshot รอบสั่งซื้อส่ง**ทุกรอบ**ของ supplier (josh แทนทั้งชุด) — ปุ่ม "ส่งให้ josh อีกครั้ง" ใช้ซ่อมเมื่อ dead-letter
- commerce ไม่มี poll ของตัวเอง (`GET /products/get-order-periods` ของ Jagota Node) — ใช้ poll ของ josh ที่ส่งต่อมาทาง fallback
- วันที่ส่งได้: ว่าง หรือเลือกครบ 7 วัน = ทุกวัน (ค่าเริ่มต้นของ josh) · แก้ได้เฉพาะหลังสลับ (ฟอร์มของ josh ไม่มีช่องนี้)
- ค่าแปลกที่มีอยู่แล้วใน josh (เช่นชื่อวันที่ไม่รู้จัก) ถูก import มาตามเดิม แต่ถ้าแก้ในฟอร์มต้องเป็นค่าที่ถูกต้อง
