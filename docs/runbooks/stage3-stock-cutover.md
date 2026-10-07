# ขั้น 3 — สลับ stock ให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-07-stage3-stock.md` · spec §2.4, §3.2, §3.3, §4.3

ทำโดย ops · ต้องเปิดช่อง event ขั้น 0 ไว้แล้ว (`JOSH_EVENTS_TO_COMMERCE_ENABLED=true`, order.snapshot เข้ามาแล้ว)

## ก่อน shadow

1. merge + deploy commerce (migration `1794600000000-StockOwnership` — รวมแถว `inventory_levels` ที่ซ้ำแล้วใส่ unique index)
   และ josh (branch `feat/commerce-owns-stock`) — flag ทุกตัวยังปิด
2. ตรวจคลังใน commerce-admin → Inventory per warehouse: คลังที่ไม่ควรนับเป็นยอดขายได้ (เสียหาย / ระหว่างขนส่ง) ตั้ง
   `UPDATE warehouses SET sellable = false WHERE code = '…'`
3. commerce `CRON_ERP_FALLBACK_REPLAY_ENABLED=true` (ปลอดภัยเปิดได้เลย — ERP call ที่ตกค้างเข้า ledger ตาม `CHANGED_AT` ของมันเอง)

## Shadow ~1 สัปดาห์

4. ทุกวันเทียบยอด — ส่วนต่างต้องเป็น 0 (ยกเว้น SKU ที่ ERP ส่งมาระหว่างการเทียบ):
   - commerce: `SELECT p.sku, SUM(GREATEST(l.quantity - l.reserved, 0))::int FROM inventory_levels l JOIN warehouses w ON w.id = l.warehouse_id AND w.sellable JOIN products p ON p.id = l.product_id WHERE l.deleted_at IS NULL GROUP BY p.sku`
   - josh: `SELECT product_inventory_sku, product_inventory_quantity FROM product_inventory`
   - ถ้ามีคลัง ERP มากกว่า 1 คลัง ส่วนต่างตอนนี้คือบั๊กเดิมของ josh (คลังที่ส่งทีหลังทับคลังอื่น) — หลังสลับจะถูกต้อง

## วันสลับ

5. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `inventory.sellable.snapshot` (เก็บ `inventory.qty.changed`
   ไว้ได้ — josh จะรับแล้วข้ามเองเมื่อเปิด flag)
6. josh: `COMMERCE_OWNS_STOCK=true` แล้ว restart
   - แก้จำนวน stock ในหน้า admin ของ josh → 403 (แก้ field อื่นในฟอร์มเดิมได้ตามปกติ)
   - หน้า PDP / ตรวจ stock ที่ดึงจาก ERP สด จะไม่เขียนทับจำนวนของ josh อีก
   - `/api/erp/products/qty` ของ josh ยังรับได้เสมอ (ทางสำรองตอน commerce ล่ม) และเทียบ version กับของ commerce
7. ส่ง snapshot ทุก SKU ครั้งแรก (admin token): `POST https://commerce.joshapp.io/api/stock/sellable-snapshots/resend`
   → `{ sent }` · josh ได้ยอดรวมคลังที่ขายได้ของทุก SKU ภายในไม่กี่นาที แล้วเทียบตามข้อ 4 อีกครั้ง
8. คลังของเราเอง (ถ้ามี): ตั้ง `warehouses.stock_source = 'commerce'` ทีละคลัง แล้วตั้ง
   `STOCK_ORDER_WAREHOUSE_CODE=<code>` ถ้าให้ order จาก josh ตัดคลังนั้น — รับเข้า / ตรวจนับ / โอนย้าย ที่ commerce-admin → Stock moves
9. ทดสอบ: SKU ทดสอบ ERP ส่ง qty → josh `product_inventory_quantity` เท่ากับยอดรวมคลังที่ขายได้ภายในไม่กี่วินาที และหน้า PDP แสดงเลขใหม่
   (ไม่ต้องรอ cache 24 ชม.)

## Rollback

- josh: เอา `COMMERCE_OWNS_STOCK` ออก แล้ว restart → josh รับ `inventory.qty.changed` และดึง ERP สดเองตามเดิม
- commerce: เอา `inventory.sellable.snapshot` ออกจาก subscription · `STOCK_ORDER_WAREHOUSE_CODE` ลบออก
- ledger ของ commerce ไม่ต้องย้อน — เป็นบันทึกเพิ่มอย่างเดียว

## ข้อจำกัด

- `low_stock_threshold` / `reorder_quantity` ยังแก้ที่ josh (ขั้น 4 สินค้า)
- order ที่ตัด stock แล้วถูกลบบรรทัดออกภายหลัง (ไม่ใช่ยกเลิกทั้ง order) ยังไม่คืน stock ของบรรทัดนั้น
