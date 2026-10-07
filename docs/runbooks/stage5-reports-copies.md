# ขั้น 5 — รายงานใน commerce อ่านสำเนาแทน replica ของ josh

แผน: `docs/superpowers/plans/2026-10-08-stage5-data-jobs.md` · spec §1 (ไม่มี read replica)

ทำโดย ops · ไม่มี migration และไม่ต้องแก้ josh · ทุก switch ค่าเริ่มต้น `replica` (เหมือนเดิม) — สลับทีละตัวด้วย env
แล้ว restart commerce · rollback = ตั้งกลับเป็น `replica`

## ก่อนเริ่ม

- ช่อง event ขั้น 0 เปิดแล้ว (`JOSH_EVENTS_TO_COMMERCE_ENABLED=true` ที่ josh) และ outbox ของ josh ไม่ค้าง
  (`SELECT count(*) FROM commerce_outbox WHERE sent_at IS NULL` ≈ 0)
- backfill เสร็จแล้ว: order (`prod-data-from-josh.md` แถว 0–1), customer / staff / company / restaurant_place (`stage2c-winback-copies.md` ข้อ 3)
- ตอนเทียบ (parity) ต้องยังมี `JOSH_DATABASE_URL` อยู่ — ถอดออกหลังสลับครบเท่านั้น

## ข้อมูลเพิ่มจาก josh (S5-11) — ทำครั้งเดียว ก่อนสลับรายงานที่ต้องใช้

ข้อนี้มี migration ทั้งสองฝั่ง (ข้อความด้านบน "ไม่มี migration" ใช้กับ switch ในตารางถัดไป)

1. deploy commerce ก่อน (migration `JoshReportCopies1795200000000`) — ถ้า josh ไปก่อน event ชนิดใหม่จะได้ 400 และค้าง retry
2. รัน `Database Migration` ของ josh แล้ว deploy backend (migrations `17923[6-9]0000000-CommerceOutbox*`, `1792400000000-CommerceOutboxJagotaSync`)
3. backfill ทีละกลุ่ม (`POST /api/reports/order-copy/backfill`): `branch` → `company` → `catalog` → `jagota_sync` → `order`
   (order ใหญ่สุด รอ `commerce_outbox` ของ josh ลดจนเกือบ 0 ก่อนกลุ่มถัดไป)
4. ตรวจ: `josh_catalog_products` ที่ `removed_at IS NULL AND category_id IS NULL` ≈ จำนวนสินค้าที่ไม่มีหมวดใน josh ·
   `josh_branches` เท่ากับ `branch` ของ josh · `josh_orders.sending_date` มีค่า · `jagota_order_sync_history.source_version > 0`
   ครบทุกแถวที่ import มา · `max(imported_at)` ขยับตามการส่ง ERP ใหม่
5. หลังข้อ 4: ปิด `CRON_JAGOTA_SYNC_IMPORT_ENABLED` ได้ (event แทนการ import แล้ว)

ตัวอ่าน (products copies mode, รายละเอียด order: payments / shipments / branch, คืนเงินใน sales) ยังไม่ได้ต่อกับ
ตารางใหม่ — ดู STATUS "Next"

## ข้อมูล marketing จาก josh (S5-12) — ทำครั้งเดียว ก่อนข้อ 7–8 ด้านล่าง

1. deploy commerce ก่อน (migration `JoshMarketingCopies1795300000000`)
2. รัน `Database Migration` ของ josh แล้ว deploy backend (`1792410000000-CommerceOutboxPushCampaign`,
   `1792420000000-CommerceOutboxMarketingWorkflow`)
3. backfill `push_campaign` → `marketing_workflow` (ตารางเล็ก)
4. ตรวจ: `count(*)` ของ `josh_push_campaigns` / `josh_marketing_workflows` เท่ากับ `push_campaigns` / `marketing_workflows` ของ josh ·
   `copied_at` ของ workflow ที่ active ขยับเมื่อมี enrollment ใหม่
5. หมายเหตุ: workflow ที่มีคนเข้าเป็นคลื่นใหญ่ จะสร้างแถว outbox หนึ่งแถวต่อ enrollment แต่ drainer รวมเป็น snapshot เดียวต่อ workflow ต่อรอบ (200 แถว)
   — ถ้า `commerce_outbox` ค้างนานหลังคลื่นใหญ่ ดูที่นี่ก่อน

## ลำดับ (ทีละตัว ตรวจแล้วค่อยไปตัวถัดไป)

| # | env | ตรวจก่อนสลับ | ผ่านเมื่อ |
|---|---|---|---|
| 1 | `WINBACK_REPORTS_SOURCE=copies` | เปิด `/reports/winback` ก่อน/หลัง เทียบตัวเลข pool / GMV / scorecard | เท่ากัน (ตาราง winback ทั้งสองฝั่งตรงกันด้วย `WinbackMirror` หรือ `WINBACK_OWNER=commerce`) |
| 2 | `RESTAURANTS_SOURCE=copies` | `GET /api/reports/restaurants/parity` | `total`, `enriched` เท่ากัน; `linked_to_winback` ต่างได้ (ของ josh ค้างตั้งแต่ 2b) |
| 3 | `BESTSELLERS_SOURCE=shadow` → `copies` | log `bestsellers shadow (copies vs replica)` ~1 สัปดาห์ | `firstDiffRank` เป็น null หรือ ≥ 50 |
| 4 | `SALES_SOURCE=copies` | `GET /api/reports/sales/parity?period=last_month` และ `?period=this_month` | `differs` ว่าง (หรืออธิบายได้), `topProducts.firstDiffRank` null หรือ > 20 |
| 5 | `GROWTH_SOURCE=copies` | หลังข้อ 4 และ S5-12 ข้อ 4 · เปิด `/marketing/growth` และผลของ workflow หนึ่งตัว | ยอดขายตรงกับ `/reports/sales`; รายได้ที่ให้เครดิตของ workflow เท่ากับก่อนสลับ; ตะกร้าขึ้น "ยังไม่มีสำเนาใน commerce" (ถูกต้อง) |
| 6 | `ORDERS_SOURCE=copies` | เทียบ `/api/reports/orders/summary` ก่อน/หลัง (ช่วงเดือนที่แล้ว) | `total`, `paid_value`, `settled_without_payment` เท่ากัน; `sync_*` ใกล้กัน (สำเนา ERP-send สดเท่าการ import ล่าสุด) |
| 7 | `PUSH_CAMPAIGNS_SOURCE=copies` | หลัง S5-12 ข้อ 4 · เทียบ `/api/reports/push-campaigns/overview` ก่อน/หลัง | `campaigns`, `scheduled`, `totalSent` เท่ากัน (ผลส่งรายคนยังมาจาก Mongo ของ josh) |
| 8 | `MARKETING_WORKFLOWS_SOURCE=copies` | หลัง S5-12 ข้อ 4 · เทียบ `/api/reports/marketing-workflows?days=30` ก่อน/หลัง | `enrolled` / `failed` / `failed_runs` ต่อ workflow เท่ากันหรือมากกว่าเล็กน้อย (สำเนานับเป็นวันเวลาไทย อาจเกินช่วง rolling ได้ไม่ถึงหนึ่งวัน) |

ไม่ต้องตั้งอะไร: staff price ตาม SKU (อ่านสำเนาแค็ตตาล็อกก่อนเอง) และหน้า health (ใช้สำเนา ERP-send เองเมื่อไม่มี replica)

## ยังต้องใช้ replica (ถอด `JOSH_DATABASE_URL` แล้วหน้าเหล่านี้จะบอกเหตุผลแทน 503 เปล่า)

- ยังไม่มี snapshot group (ไม่ได้สร้างเอง — ต้องให้เจ้าของ / แผนตัดสิน): ตะกร้าค้าง (`cart_snapshot` / `user_devices`) ใน Growth,
  enrollment ราย company ใน timeline ของ Growth
- ตัวอ่านยังไม่ต่อกับสำเนา S5-11: ดู STATUS "Next" (รายงานสินค้า, รายละเอียดออเดอร์, คืนเงิน) · ลูกค้า (KYC / เครดิต — รอเจ้าของตัดสิน)
- รอเจ้าของตัดสิน: traffic, order target group
- อยู่ที่ josh-admin: back-office (KYC, เครดิต, CN/CB …), โปรโมชันและราคาตามสาขา (จนถึง G9)
  — หน้า Segments ใช้ `/j/segments` (commerce เป็นเจ้าของตั้งแต่ 2a) ไม่ต้องใช้ `/josh/segments`
- เครื่องมือช่วงย้าย (เลิกใช้ใน stage 7): price-shadow / jagota-shadow ปุ่ม Run, jagota-sync / order-copy import,
  staff-prices import, `WinbackMirror`, CLI `import-from-josh` / `*-parity`

## ถอด replica (S5-16)

ทำเมื่อข้อ 1–8 ผ่านครบ และ S5-11 / S5-12 เสร็จ: staging ก่อน — ลบ `JOSH_DATABASE_URL` แล้วเปิดทุกหน้าใน
commerce-admin + เรียก MCP tool ทุกตัว บันทึกผลใน plan ("As built") · ปิด cron ที่ดึงจาก replica (S5-15) หลังเชื่อ event + backfill แล้ว:
`CRON_JOSH_ORDER_COPY_ENABLED=false`, `CRON_JOSH_CATALOG_SYNC_ENABLED=false`, `CRON_JAGOTA_SYNC_IMPORT_ENABLED=false`,
`CRON_STAFF_PRICES_IMPORT_ENABLED=false` (`CRON_JAGOTA_SYNC_IMPORT` ปิดได้หลัง `jagota_sync` snapshot ใน S5-11 เท่านั้น)
