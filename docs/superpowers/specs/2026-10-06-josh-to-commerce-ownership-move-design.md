# ย้ายความเป็นเจ้าของข้อมูลจาก josh มา commerce — design

> สถานะ: อนุมัติ design แล้ว (2026-10-06) · ขั้นถัดไป: implementation plan ของขั้น 0
> ที่มา: ตัดสินใจกับ user 2026-10-06 หลัง commerce ขึ้น prod (https://commerce.joshapp.io)
> เกี่ยวข้อง: `docs/event-contract.md` (commerce → platforms), `docs/erp-integration-tasks.md` §0–0.2

## 1. เป้าหมายและขอบเขต

ย้ายทุก feature ของ josh มาให้ commerce เป็นเจ้าของ **ยกเว้น order และการชำระเงิน** งานด้านข้อมูล
(report / metrics / analytics) ย้ายมา commerce ทั้งหมด

**ไม่ทำ:**
- read replica ของ josh — ไม่ใช้ commerce จะได้ข้อมูลที่ josh เป็นเจ้าของ (order / การชำระเงิน / ลูกค้า)
  ผ่าน event เท่านั้น
- สะพานอ่าน DB ของ josh ระหว่างย้าย — หน้าใน commerce ที่ยังอ่าน `JOSH_DATABASE_URL` จะขึ้น
  "not configured" จนกว่า feature นั้นจะย้ายเสร็จ (ยอมรับแล้ว)

**การแบ่งความเป็นเจ้าของ (ปลายทาง):**

| ข้อมูล | เจ้าของ | อีกฝั่งได้ข้อมูลจาก |
|---|---|---|
| order, รายการสินค้า, สถานะ, การชำระเงิน, checkout | josh | commerce เก็บสำเนาจาก `order.snapshot` |
| ลูกค้า — ส่วนที่ใช้ตอนซื้อ (login/รหัสผ่าน/OTP, ที่อยู่จัดส่ง, ข้อมูลบริษัท/ใบกำกับภาษี) | josh | commerce เก็บสำเนาส่วนที่ไม่อ่อนไหวจาก `customer.snapshot` |
| ลูกค้า — ส่วนข้อมูล/การตลาด (segment, metrics, winback, tag, CRM, consent) | commerce | josh ได้เฉพาะสิ่งที่หน้า shop ใช้ (เช่น tag/segment สำหรับโปรโมชัน) ผ่าน event |
| พนักงาน (admin, MER, CS, marketing) | commerce | – |
| competitor prices / scraping / research | commerce | – |
| stock (ledger ต่อคลัง) | commerce | josh เก็บยอดรวมต่อ SKU จาก `inventory.sellable.snapshot` |
| สินค้าและราคา (ทุกกลุ่ม field) | commerce | josh เก็บสำเนาที่หน้า shop อ่าน |

**กฎที่ต้องคงไว้** (จากการตัดสินใจก่อนหน้า):
1. josh และ commerce ต้องอยู่รอดได้แม้อีกฝั่งล่ม — หน้า shop / checkout อ่าน DB ของ josh เอง ไม่รอ commerce
2. josh ห้ามช้าลง — ทุกอย่างที่เพิ่มใน josh ต้องเป็นกลางหรือดีขึ้นต่อ runtime
3. `/api/erp` ของ josh ต้องรับ call จาก ERP ได้เสมอ (ทางสำรองของ nginx) ห้ามปิด/gate
4. ทุกการเปลี่ยนแปลงใน josh เป็นแบบเพิ่ม (additive) และค่าเริ่มต้นปิด
5. PDPA: ลูกค้าขอลบข้อมูล → ต้องลบทั้งสองฝั่ง

## 2. ขั้น 0 — ช่องทาง event สองทาง

### 2.1 ทาง commerce → josh (มีแล้ว)

ใช้ของเดิมตาม `docs/event-contract.md`: outbox ของ commerce (`outbox_messages`, LISTEN/NOTIFY + poll 2s)
→ webhook subscription → BullMQ → POST ไป `josh /api/internal/erp-events` (HMAC ด้วย secret ของ
subscription, กันซ้ำด้วย `x-delivery-id`) ฝั่งรับของ josh อยู่บน `origin/main` แล้ว
(`apps/backend/src/app/erp/commerce-erp-events.controller.ts`)

ต้องแก้: เอกสาร `event-contract.md` ขัดกันเรื่องจำนวน retry (บรรทัด 47 ตรงกับโค้ด: 200 ครั้ง backoff
สูงสุด 60s ≈ 3 ชม.; บรรทัด 85 เขียน "5 retries 30s→4m") → แก้บรรทัด 85 ให้ตรงโค้ด

### 2.2 ทาง josh → commerce (สร้างใหม่)

ต่อยอดรูปแบบ `order_settled_outbox` ที่ josh มีอยู่ (drain หลัง commit + cron sweep)

**เก็บ event — DB trigger**
- ตารางใหม่ใน josh `commerce_outbox(id bigserial, type text, aggregate_id uuid, created_at timestamptz,
  sent_at timestamptz null, attempts int, last_error text, next_attempt_at timestamptz)`
- trigger `AFTER INSERT OR UPDATE` บน `orders`, `order_items`, ตารางการชำระเงิน (ชื่อตารางจริงระบุใน implementation plan หลังอ่านโค้ด josh), `users` (เฉพาะลูกค้า)
  → INSERT 1 แถว `(type, aggregate_id)` ใน transaction เดิม
- `AFTER DELETE` บน `users` (ลูกค้า) → `customer.deleted`
- เหตุผลที่ใช้ trigger: order ถูกแก้จากหลายที่ (checkout, ERP webhook, admin, cron) — trigger จับได้ครบ
  โดยไม่แตะโค้ด checkout; ต้นทุน 1 INSERT ต่อการเปลี่ยนแปลง

**ส่ง event — drainer**
- หลัง commit (TypeORM subscriber แบบ `OrderSettledSubscriber`) + cron sweep ทุก 1 นาทีเป็น backstop
- claim แถวด้วย `FOR UPDATE SKIP LOCKED` (josh backend รัน 2 instance) และรวมแถวซ้ำของ aggregate เดียวกัน
  เป็นการส่ง 1 ครั้ง
- อ่าน **สถานะล่าสุดทั้งก้อน** ของ aggregate จาก DB ของ josh + `nextval('commerce_snapshot_seq')` เป็น
  `version` ใน transaction เดียวกัน
- POST `commerce /api/internal/josh-events` — header `x-event-type`, `x-delivery-id`, `x-signature`
  (HMAC-SHA256 hex ของ body ด้วย `JOSH_EVENTS_SECRET` ค่าเดียวกับที่ commerce ใช้อยู่)
- ล้มเหลว → `attempts++`, `next_attempt_at` = backoff (1s·2^n สูงสุด 60s) — ส่งได้เรื่อยๆ ไม่ทิ้ง
- flag `JOSH_EVENTS_TO_COMMERCE_ENABLED` (ค่าเริ่มต้นปิด): ปิด = trigger ยังบันทึก แต่ไม่ส่ง;
  แถวที่ส่งแล้วเก็บ 7 วันแล้ว prune (เหมือน `order_settled_outbox`); แถวที่ไม่ส่งเพราะ flag ปิดเก็บ
  สูงสุด 7 วันเช่นกัน แล้วให้ backfill (§2.5) ซ่อม

**ชนิด event (josh → commerce)**

| type | aggregate | payload |
|---|---|---|
| `order.snapshot` | order id | order + รายการสินค้า + สถานะ + สถานะการชำระเงิน + ยอดเงิน + บริษัท/สาขา + ลูกค้า id |
| `customer.snapshot` | user id | id, ชื่อ, อีเมล, เบอร์, บริษัท/สาขา, วันที่สมัคร, segment/tag ของ josh — **ไม่มี** รหัสผ่าน / OTP / token |
| `customer.deleted` | user id | id เท่านั้น |
| `erp.fallback.received` | ERP item key | ERP call ที่ยิงตรงเข้า josh `/api/erp/*` (body เดิม + path + received_at) — ดู §3.3 |
| `*.snapshot` (backfill) | ตามกลุ่ม | ดู §2.5 |

Body ทุกตัว: `{ type, version, occurredAt, aggregateId, data }`

**ฝั่ง commerce — receiver ใหม่**
- `POST /api/internal/josh-events` ตรวจ HMAC (fail closed บน prod), กันซ้ำด้วย `x-delivery-id`
- upsert ลงตารางสำเนา `josh_orders`, `josh_order_items`, `josh_customers` แบบ
  `... WHERE source_version < $version` (§3.1)
- publish domain event ภายใน commerce (เช่น `JoshOrderChanged`) ให้ report, stock ledger (§4.3),
  winback ใช้ต่อ
- `customer.deleted` → ลบสำเนาลูกค้าและข้อมูลการตลาดที่ผูกกับคนนั้น (PDPA)
- status: 200 = รับหรือทิ้งเพราะเก่ากว่า, 4xx = payload ผิด (ไม่ retry), 5xx = retry

### 2.3 กันข้อมูลเก่าทับข้อมูลใหม่ (ทั้งสองทาง)

ทุก event มี `version` ต่อ aggregate — ผู้รับเก็บ version ล่าสุด และรับเฉพาะตัวที่ใหม่กว่า; ตัวที่เก่ากว่า
ตอบ 200 แล้วทิ้ง (ผู้ส่งจะเลิก retry)

**josh → commerce:** `version` = `commerce_snapshot_seq` (sequence ของ Postgres เพิ่มขึ้นเสมอแม้รันหลาย
instance) — ไม่ใช้ `updated_at` เพราะเวลาอาจชน และบางจุดแก้ข้อมูลโดยไม่อัปเดตเวลา

**commerce → josh:** ฝั่งรับของ josh ตอนนี้ไม่มีการกันเลย → เพิ่มตาราง
`commerce_applied_versions(aggregate_type, aggregate_id, version timestamptz, primary key(aggregate_type, aggregate_id))`
เช็กและบันทึกใน transaction เดียวกับที่อัปเดตข้อมูล

**version ของ stock = เวลาที่เปลี่ยนจริงจากต้นทาง** (`CHANGED_AT` ของ ERP หรือเวลาของ movement ใน ledger
ของ commerce) ไม่ใช่เวลาที่ส่ง — เพื่อให้เทียบกับทางสำรองของ ERP ได้ (§3.3)

ข้อจำกัดที่ยอมรับ: event 2 ตัวที่ version เท่ากันพอดี → รับตัวที่มาถึงก่อน; snapshot ครั้งถัดไปแก้ให้ตรง

### 2.4 flag ปิดการเขียนข้อมูลแต่ละกลุ่มใน josh

ต่อยอด `apps/backend/src/app/erp/commerce-ownership.flag.ts` (`CommerceOwned('COMMERCE_OWNS_X', msg)`)

| flag | สถานะ | เมื่อเปิด josh จะ |
|---|---|---|
| `COMMERCE_OWNS_COMPETITOR` | ใหม่ | 403 ที่ `competitor-prices` (เขียน), `competitor-scraping`, `marketing-research` (เขียน); หยุด cron `hourlyRefresh` (ตอนนี้ไม่มี flag), scraping tick, `CRON_MARKETING_RESEARCH_ENABLED`, research free worker |
| `COMMERCE_OWNS_STOCK` | ใหม่ | 403 ที่ช่อง qty/low_stock/reorder ใน `POST/PATCH /api/product`; หยุด `syncStockBatch` (ดึง stock จาก ERP เอง); รับ stock จาก `inventory.sellable.snapshot` และทางสำรอง `/api/erp/products/qty` เท่านั้น |
| `COMMERCE_OWNS_PRICES` / `CATALOG` / `PROMOTIONS` | มีแล้ว | อุดช่องที่ยังแก้ได้โดยไม่ผ่าน flag: หมวดหมู่ (`product-category.controller.ts`), แบรนด์ (`brand.controller.ts`), tier_prices, MOQ, ordering/season dates, `sync-product-status`, `sync-inventory-metadata`, การอนุมัติคำขอราคาของ CS (`cs-admin.controller.ts` price-requests), `POST promotion-rules` |
| `COMMERCE_OWNS_CUSTOMERS` | มีแล้ว — **ปรับขอบเขต** | ตอนนี้ล็อก user/สาขา/sales rep/credit application ใน CS-admin ซึ่งรวมข้อมูลที่ใช้ตอนซื้อ → ปรับให้ล็อกเฉพาะข้อมูลการตลาด (segment, tag, consent, winback) ก่อนเปิดใช้ |

ทุก flag: ค่าเริ่มต้นปิด · `/api/erp` รับได้เสมอ · ปิด flag = josh แก้ได้ทันที (rollback)

ฝั่ง commerce: ช่องที่เขียน `product_inventory_quantity` ผ่าน relay (`CATALOG_FIELDS` ใน josh
`commerce-product-actions.controller.ts:19`) ต้องเอาออก — stock ไปทาง `inventory.sellable.snapshot` เท่านั้น

### 2.5 Backfill

ไม่มีทางอ่าน DB ของ josh → ข้อมูลตั้งต้นของแต่ละกลุ่มไหลผ่านช่องทาง event เดิม

- josh: คำสั่ง (CLI หรือ internal endpoint ที่ลงลายเซ็น) `backfill <group>` ใส่แถว `<group>.snapshot`
  ของทุก aggregate ในกลุ่มลง `commerce_outbox` เป็นชุดๆ (เช่น 500 แถว/รอบ หน่วงระหว่างรอบ) เพื่อไม่ให้
  กระทบ josh
- กลุ่มที่ต้องรองรับ: `order`, `customer`, `competitor`, `stock`, `product`, `price` (และกลุ่ม field ย่อยของสินค้า)
- ใช้ซ้ำได้: ซ่อมข้อมูลเมื่อสงสัยว่าเพี้ยน หรือหลัง flag ส่งถูกปิดนานเกิน 7 วัน

## 3. กรณีพิเศษ

### 3.1 upsert แบบเช็ก version (commerce)

```sql
INSERT INTO josh_orders (id, ..., source_version) VALUES (...)
ON CONFLICT (id) DO UPDATE SET ... WHERE josh_orders.source_version < EXCLUDED.source_version;
```

### 3.2 stock ที่ส่งให้ josh

commerce เก็บ ledger ต่อคลัง แต่ josh เก็บตัวเลขเดียวต่อ SKU (`product_inventory_quantity`) และตอนนี้
`handleQtyChange` ไม่สนใจ `warehouseCode` (คลังที่ส่งมาทีหลังทับคลังอื่น) → commerce ส่ง
`inventory.sellable.snapshot { sku, sellableQty, version }` โดย `sellableQty` = ผลรวมทุกคลังที่ขายได้,
`version` = เวลาของการเปลี่ยนแปลงล่าสุดในทุกคลังของ SKU นั้น

### 3.3 ERP ยิงตรงเข้า josh ระหว่าง commerce ล่ม

1. ทางตรงจาก ERP ใช้ `CHANGED_AT` เป็น version และใช้ `commerce_applied_versions` ตารางเดียวกัน →
   ทั้งสองทางเทียบกันได้ ตัวที่ใหม่กว่าชนะ
2. josh ส่งต่อทุก call ที่เข้า `/api/erp/*` เป็น `erp.fallback.received` ผ่าน `commerce_outbox` →
   commerce กลับมาแล้วนำไปลง ledger / ข้อมูลของตัวเองต่อจนครบ (ใช้ `CHANGED_AT` เดิม จึงไม่ซ้ำกับที่
   ERP ส่งให้ commerce โดยตรง)

## 4. ลำดับการสลับ

### 4.1 ขั้นตอนต่อกลุ่ม (เหมือนกันทุกกลุ่ม)
1. commerce พร้อม — หน้าจอ/API ครบเทียบเท่า josh
2. backfill กลุ่มนั้น (§2.5)
3. shadow ราว 1 สัปดาห์ — josh ยังเป็นผู้เขียนและส่ง snapshot ทุกการเปลี่ยนแปลง; commerce เทียบกับข้อมูล
   ของตัวเองจนไม่มีส่วนต่าง (แบบ `price-shadow` ที่มีอยู่)
4. สลับ — เปิด `COMMERCE_OWNS_X` ใน josh + เปิดการส่ง event ของกลุ่มนั้นใน commerce
5. rollback — ปิด flag; ข้อมูลที่แก้ใน commerce ระหว่างนั้นถูกส่งให้ josh แล้ว จึงไม่มีข้อมูลหาย

### 4.2 ลำดับกลุ่ม

| # | กลุ่ม | ต้องมีก่อน |
|---|---|---|
| 0 | ช่องทาง event สองทาง (§2) | – |
| 1 | competitor / scraping / research | 0 · commerce ต้องมีระบบ review / overview / export / match-queue / candidates / match / confirm (josh `competitor-review.service.ts`, `competitor-size.ts`, migration CompetitorReview), bug fix josh PR #454 (`catchUp`) และ #455 (`advanceOrRetry`) |
| 2 | ลูกค้าด้านการตลาด | 0 · ปรับขอบเขต `COMMERCE_OWNS_CUSTOMERS` |
| 3 | stock | 0 · `order.snapshot` ใช้งานได้แล้ว (§4.3) · หน้าจอรับเข้า/ตรวจนับ/โอนย้าย · ปิด `/inventory` CRUD ที่ข้าม ledger · แก้ race ใน `adjustOwnStock` |
| 4 | สินค้าและราคา ทีละกลุ่ม: ราคาเฉพาะลูกค้า/ราคาสัญญา → ราคาตั้ง + คิวอนุมัติ MER + ย้าย webhook ราคา/MOQ ของ ERP → ตัวตน/เนื้อหา/หน่วย → หมวดหมู่/แบรนด์ → การสั่งซื้อ/โลจิสติกส์ → โปรโมชัน → รูปภาพ | 0 · commerce ต้องมีตารางสินค้าครบทุก field (ตอนนี้ `product` เป็นแค่โครง) และ consumer ฝั่ง josh ที่อัปเดต `product_inventory` + translations + ราคา + media และล้าง Redis/PDP cache |

### 4.3 การตัด stock จาก order

ตอนนี้การจอง/ตัด stock อยู่ใน Redis ของ josh (`sellable-stock.service.ts`) เท่านั้น ไม่ถึง commerce →
commerce อ่าน `order.snapshot` แล้วบันทึก movement ลง ledger ของคลังที่ commerce เป็นเจ้าของ
(`warehouses.stock_source = 'commerce'`) เมื่อสถานะ order เปลี่ยนเป็นยืนยัน/ยกเลิก — checkout ของ josh
ยังเช็กจาก DB ของตัวเองเหมือนเดิม

## 5. งานในแต่ละ repo

**josh** (เพิ่มอย่างเดียว ค่าเริ่มต้นปิด):
- `commerce_outbox` + trigger + drainer + cron sweep + `JOSH_EVENTS_TO_COMMERCE_ENABLED`
- `commerce_snapshot_seq`, `commerce_applied_versions` + เช็ก version ใน `commerce-erp-events.controller.ts`
  และทางตรง `/api/erp/products/qty`
- ส่งต่อ `erp.fallback.received`
- คำสั่ง backfill
- flag `COMMERCE_OWNS_COMPETITOR`, `COMMERCE_OWNS_STOCK` + guard ที่ยังขาด (§2.4) + ปรับขอบเขต
  `COMMERCE_OWNS_CUSTOMERS`
- เอา `product_inventory_quantity` ออกจาก `CATALOG_FIELDS`
- consumer `inventory.sellable.snapshot`

**commerce:**
- `POST /api/internal/josh-events` + ตาราง `josh_orders`, `josh_order_items`, `josh_customers` + domain events
- ส่ง `inventory.sellable.snapshot` (รวมทุกคลัง)
- ต่อ `erp.fallback.received` เข้า ledger / ข้อมูลของตัวเอง
- แก้ `event-contract.md` บรรทัด 85 และเพิ่มหัวข้อทาง josh → commerce

**ops (user ต้องทำเอง — ระบบไม่ให้ Claude แก้ josh prod):** เปิด flag บน josh prod, ตั้ง
`JOSH_EVENTS_SECRET` ให้ตรงกันสองฝั่ง, สร้าง webhook subscription ใน commerce

## 6. ทดสอบ

- josh: trigger เขียน outbox ทุกทางที่แก้ order (checkout, ERP status, admin) — test ระดับ DB; drainer
  claim แบบ SKIP LOCKED ไม่ส่งซ้ำเมื่อรัน 2 instance; เช็ก version ทิ้งตัวเก่า; flag ปิด = ไม่ส่ง
- commerce: receiver ตรวจ HMAC, กันซ้ำ, upsert แบบเช็ก version (ส่งสลับลำดับแล้วได้ค่าล่าสุด),
  `customer.deleted` ลบครบ
- end to end บน staging: สร้าง order บน josh → `josh_orders` ใน commerce ภายใน 5 วินาที; commerce ล่ม
  10 นาทีแล้วกลับมา → event ค้างถูกส่งครบไม่ซ้ำ
- วัดผลกับ josh: เวลา checkout ก่อน/หลังติดตั้ง trigger ต้องไม่แย่ลง (กฎ josh ห้ามช้าลง)
