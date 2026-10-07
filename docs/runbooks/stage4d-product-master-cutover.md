# ขั้น 4d — สลับข้อมูลสินค้าจาก ERP (และคิว MER ของมัน) ให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-08-stage4d-product-master.md` · spec §2.4 และ §4.2 แถว 4 (หน่วย / การสั่งซื้อ)

ทำโดย ops · ที่ย้าย: ช่องที่ ERP ส่งมาของสินค้าที่ขายอยู่ — หน่วยขาย/หน่วยสั่ง/หน่วยที่สั่งได้, ขนาด/ชนิดแพ็ก, ต่อกล่อง, น้ำหนักต่อหน่วย,
ชื่อแบรนด์, VAT, ผู้จัดจำหน่าย, ประเภท, สถานะ, หมวด, สั่งล่วงหน้า, รหัส supplier, ฤดู — และคิว MER ที่อนุมัติการเปลี่ยนจาก ERP
· **ยังอยู่ josh:** สินค้าใหม่จาก ERP (draft) — josh สร้าง draft พร้อมค่าจาก ERP และ MER เปิดขายที่หน้าสินค้า (relay อนุมัติไป josh)
· ราคา/MOQ เป็นของขั้น 4a

ต้องทำขั้น 4c ก่อน (branch นี้ต่อจาก 4c; ฟอร์มสินค้าใช้ `product_categories` แปลงหมวดเป็นรหัส)

## ก่อน shadow

1. merge + deploy commerce (migration `1795000000000-ProductMasters`) และ josh (`feat/commerce-owns-product-master`) — flag ปิดทั้งหมด
2. `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- categories` (ถ้ายังไม่ได้ทำ) แล้ว `-- masters`
   แล้ว `npm run master-parity` → `different: 0, notLiveInJosh: 0`

## Shadow ~1 สัปดาห์

3. ทุกวัน: import `masters` อีกรอบแล้ว `npm run master-parity` — ต้องตรง (ยังอนุมัติที่ josh ตามปกติ)

## วันสลับ

4. แจ้ง MER ให้หยุดอนุมัติข้อมูลสินค้าจาก ERP ~15 นาที
5. `npm run import-from-josh -- masters` รอบสุดท้าย (ดึงคิวที่ค้างใน josh ส่วนนี้มาด้วย) แล้ว `npm run master-parity` = ตรง
6. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `product.master.snapshot`
7. josh: `COMMERCE_OWNS_PRODUCT_MASTER=true` แล้ว restart — ERP ไม่พักช่องเหล่านี้ของสินค้าที่ขายอยู่ใน josh อีก, Jagota sync ไม่ทับ,
   `POST /product/admin/sync-product-status` → 403, คิวเดิมของ josh อนุมัติแล้วใช้เฉพาะส่วนที่ไม่ใช่ข้อมูลนี้
8. commerce: `COMMERCE_OWNS_PRODUCT_MASTER=true` แล้ว restart
9. ทดสอบ: ERP ส่ง product upsert ของ SKU ทดสอบ (เปลี่ยนหน่วยขาย) → ขึ้นใน commerce-admin → คิวข้อมูลสินค้าจาก ERP → อนุมัติ →
   josh `product_inventory.selling_unit` เปลี่ยน · แก้สถานะ/หมวดในฟอร์มสินค้า → josh เปลี่ยน, หน้าร้านเห็น
10. `npm run master-parity` อีกครั้ง → ตรง (`joshOnly` = สินค้าที่เพิ่งเปิดขายจาก draft และยังไม่เคยเปลี่ยน — ปกติ)

## Rollback

- ปิด `COMMERCE_OWNS_PRODUCT_MASTER` ทั้งสองฝั่ง → josh พักและอนุมัติเองตามเดิม · subscription: เอา `product.master.snapshot` ออก
- ค่าที่อนุมัติ/แก้ใน commerce อยู่ใน josh แล้ว · คิวที่ค้างใน commerce ให้ ERP ส่งซ้ำ หรือรอรอบ sync ถัดไป · เปิดกลับ: import `masters` ใหม่ก่อน

## ข้อจำกัด

- ERP ยิงเข้า josh ตรง (ตอน commerce ล่ม) → josh ส่งต่อเป็น `erp.fallback.received` → commerce เข้าคิวเมื่อเปิด
  `CRON_ERP_FALLBACK_REPLAY_ENABLED`
- เปลี่ยน `pack_size` โดยไม่ส่งน้ำหนัก/ต่อกล่อง/ชนิดแพ็กมาด้วย → commerce ทิ้งค่าเก่าของสามช่องนั้น ให้ josh คำนวณจาก `pack_size`
  (กติกาเดียวกับตอน josh อนุมัติเอง)
- ฟอร์มสินค้าแสดงหมวดจากสำเนาของ josh (commerce เก็บเป็นรหัสหมวด)
