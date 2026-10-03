# ERP Integration — งานที่ต้องทำใน commerce-platform

> เขียน 2026-09-01 · อัปเดต 2026-10-03 ตาม josh `origin/main` @ `b5785c6ab` · ต้นทาง: `josh/docs/erp-requirements/erp-commerce-prelaunch-plan.html`
> Scope: ย้าย ERP integration (Jagota Node API) จาก `josh/apps/backend` มาอยู่หลัง adapter ของ repo นี้
> **ทำก่อน shop launch** — ไม่มี traffic จริง จึงไม่มี shadow mode / cutover / rollback plan

---

## 1. เป้าหมาย และไม่ใช่เป้าหมาย

**เป้าหมาย**

- commerce-platform เป็นด่านหน้าที่คุยกับ ERP แทน `josh/apps/backend` — สลับ/เพิ่ม ERP ได้โดยไม่แตะ checkout ของ shop
- commerce-platform เป็นเจ้าของ **inventory ต่อคลัง** (`inventory_levels`) ซึ่ง `josh/apps/backend` ไม่มีโมเดลนี้
- ทุก ingest มี retry + audit trail (ใช้ `integration/sync-job` ที่มีอยู่)

**ไม่ใช่เป้าหมาย — ห้ามทำในรอบนี้**

- ย้าย `Order` / `OrderLine` ของ shop มา `commerce_db`
- ย้าย pricing 7 ชั้น / promotion / cart / checkout ของ shop
- ให้ `shop-web` หรือ `web-admin` เรียก repo นี้โดยตรง
- เปลี่ยน payload หรือ URL ที่ตกลงกับทีม ERP ไว้แล้ว

> ถ้างานที่กำลังทำอยู่ต้องแตะข้อใดข้อหนึ่งข้างบน แปลว่าออกนอก scope แล้ว — หยุดและกลับไปคุยก่อน

---

## 2. เส้นแบ่งความเป็นเจ้าของข้อมูล

| โดเมน | เจ้าของ | หมายเหตุ |
|---|---|---|
| ERP integration (ingest, push, mapping, retry, audit) | **commerce-platform** | เป้าหมายหลัก |
| Inventory / warehouse | **commerce-platform** | `inventory_levels(product_id, warehouse_id, quantity, reserved)` มีอยู่แล้ว |
| Catalog (product master, category, price) | **josh/apps/backend** | commerce เก็บแค่ mapping + audit |
| Order / checkout / cart / pricing / promotion | **josh/apps/backend** | ห้ามแตะ |
| Customer / company / branch | **josh/apps/backend** | commerce เก็บแค่ mapping |

**หลักที่ทำให้ shop ไม่ช้าลง:** commerce เป็นเจ้าของ *ความจริง* ของสต็อกต่อคลัง แต่ต้อง **write-through** กลับไปที่ Redis + Postgres ของ shop ทุกครั้งที่ ingest สำเร็จ เพื่อให้ PLP/PDP/cart ของ shop ยังอ่าน local เหมือนเดิม (0 network hop)

---

## 2.1 ฟีเจอร์ที่แยกจาก josh — ย้ายอะไร / ไม่ย้ายอะไร

> ไฟล์ต้นทางทั้งหมดอยู่ใต้ `josh/apps/backend/src/app/` · ก่อนย้ายแต่ละ task ให้ `git log origin/main -- <path>` ดูว่ามี commit ใหม่หลังวันที่ในหัวเอกสารไหม

### ย้ายมา commerce-platform

| ฟีเจอร์ | ต้นทางใน josh | ปลายทางใน repo นี้ | Task |
|---|---|---|---|
| Inbound webhook ERP (guard `X-ERP-Key`, envelope/array pipe) | `erp/erp-webhook.controller.ts`, `erp-key.guard.ts`, `data-envelope.pipe.ts`, `single-or-array.pipe.ts`, `dto/` | `integration/connector/erp/presentation/` | 2,3,4,7 |
| คิว inbound + log | `erp/erp-inbound-enqueuer.service.ts`, `erp-inbound-queue.processor.ts`, `erp-inbound-log.util.ts` | แทนด้วย `integration/sync-job` (ไม่ copy queue ตัวเอง) | 2 |
| Stock + sellable | `jagota-order/jagota-stock.service.ts`, `sellable-stock.service.ts` | `commerce/inventory` + write-through Redis ของ shop | 2 |
| Customer/branch sync ไป ERP | `jagota-order/jagota-customer-sync.service.ts`, `erp-customer-jobs.service.ts`, `erp-customer-queue.processor.ts`, `jagota-branch-sync.service.ts`, `jagota-customer-sync.flag.ts` | `connector/erp` + `integration/mapping` | 4,5 |
| Outbound Jagota Node API client | `jagota-order/jagota-node-api.service.ts`, `interfaces/jagota-*.types.ts` | `ErpHttpClient` | 5 |
| Order/quotation push | `jagota-order/jagota-order.service.ts`, `jagota-quotation.service.ts`, `erp-order-unit.helper.ts` | `ErpConnector.createOrder()` + quotation | 5 |
| Order period / delivery calendar (probe + poll + cache) | `jagota-order/sku-order-period-*`, `supplier-order-period-*`, `delivery-calendar-probe.*`, `delivery-calendar.mapper.ts`, `jagota-delivery-date*.ts` | `connector/erp` → write-through ให้ checkout ของ shop อ่าน local | 6 |
| Cron auth token / branch status | `jagota-order/jagota-auth-token.cron.ts`, `jagota-branch-status.cron.ts` | `connector/erp` | 6 |
| ERP Webhook Simulator + mock ต่อ account | `erp/erp-webhook-simulator.controller.ts`, `erp-webhook-simulator.guard.ts` | `connector/erp` (dev/staging เท่านั้น มี kill-switch prod) + หน้าใน commerce-admin | 8 |

### ไม่ย้าย — อยู่ josh ต่อ

| ฟีเจอร์ | เหตุผล |
|---|---|
| Payment/billing ที่เรียก Jagota (`get_josh_payment`, invoice QR, KBank notify relay, `/payment/*`, `jagota-finance.service.ts` ส่วนที่ใช้ตอนจ่าย) | ผูก payment ของ shop — §1 ห้ามแตะ |
| Credit back / credit note, invoice line (`erp-invoice-line.*`) | ผูก order/billing ของ shop |
| ผลของ order/invoice status ที่ไปแก้ order ของ shop (auto-resume `payment_pending`, credit-term unpaid, notification) | commerce แค่รับ webhook + dedupe แล้วส่ง status ผ่าน internal API — logic ฝั่ง order ยังอยู่ josh |
| 3PL delivery-status (`/3pl/delivery-status`) | มาจาก 3PL ไม่ใช่ ERP |
| Shipment tracking (`shipment-tracking.service.ts`, `GET /drivers/tracking`) | read-through cache ที่ลูกค้าเรียกตรงจาก shop — ย้ายมาจะเพิ่ม network hop (cron poll GPS ถูกลบไปแล้วใน `4e7951b5e`) |
| Staging product/price รอ MER approve (`erp/erp-pending-change.helper.ts`, approve ที่ `product.controller.ts` + web-admin `AllProduct.tsx`) | **MER ทำงานที่ web-admin ที่เดียว** — commerce ส่ง change เข้า staging ของ josh ผ่าน internal API ไม่เปิดหน้า approve ซ้ำใน commerce-admin |
| competitor-prices / scraping | MER ใช้คู่กับ approve ราคาใน web-admin + join `ProductInventory` ของ shop โดยตรง — แยกออกมาจะทำให้ MER ทำงาน 2 ที่ |
| marketing-*, cache/perf ทั้งหมด | ไม่เกี่ยวกับ integration |

---

## 3. Best practice ของ repo นี้ที่ต้องทำตาม

### 3.1 Layering — บังคับด้วย test จริง

`modules/architecture.spec.ts` เป็น fitness test ที่จะ **fail จริง** ถ้า import ผิดทิศ:

```
core        →  (import อะไรไม่ได้เลย)
platform    →  core
commerce    →  core, platform
integration →  core, commerce, platform
```

งานทั้งหมดในเอกสารนี้อยู่ใน `integration/` ซึ่งเรียก `commerce/` ได้ — แต่ **`commerce/` ห้ามเรียก `integration/`** ถ้ารู้สึกว่าต้องเรียกกลับ แปลว่าวาง responsibility ผิดที่ ให้ใช้ domain event แทน

### 3.2 โครงไฟล์ต่อโมดูล

ตามที่มีอยู่ (ดู `commerce/inventory/` เป็นตัวอย่าง):

```
<module>/
  <module>.module.ts
  domain/          # entity ที่เป็น business concept, events, interface — ไม่มี TypeORM/Nest
  application/     # service, saga, dto/ — orchestrate ไม่แตะ HTTP/DB โดยตรง
  infrastructure/  # *.entity.ts (TypeORM), *.repository.ts, http client
  presentation/    # controller, route DTO
```

- Business logic อยู่ `application/` เท่านั้น — controller ผูก HTTP อย่างเดียว
- `infrastructure/` ห้ามมี business rule
- DTO ของ request/response อยู่ใต้ชั้นที่ใช้มัน ไม่กองรวมที่เดียว

### 3.3 Migrations

```bash
npm run migration:generate -- apps/commerce-platform/src/migrations/Name
npm run migration:run
npm run migration:show
```

- แก้ entity ก่อน แล้วค่อย generate — อย่าเขียน migration ด้วยมือ
- **อ่าน `up`/`down` ที่ generate มาทุกครั้งก่อน commit** TypeORM ชอบ generate drop column ที่ไม่ได้ตั้งใจ
- ตอนนี้มี 5 migration งานนี้จะเพิ่มอีก ~2-3

### 3.4 Test

- ทุก service ใหม่ต้องมี `.spec.ts` คู่ — repo นี้ทำแบบนี้ทั้งหมดแล้ว รักษาไว้
- **DTO ที่ copy มาจาก josh ต้องมี test ที่ assert ชื่อ field ตรงตัว** (เช็ค `DOC_NO`, `PRODUCT_CODE` ยังสะกดเหมือนเดิม) — เพราะสองฝั่งคนละ repo ไม่มี shared type ถ้าใครแก้ฝั่งเดียว test ต้องแตก
- ingest ต้องมี test เคส "ERP ยิงซ้ำ payload เดิม" → ผลลัพธ์ต้องเหมือนเดิม (idempotent)

### 3.5 หลักการเขียน connector

- **แยก boundary ออกจาก field mapping** — route / adapter interface / retry / mapping table ไม่ควรรู้จักชื่อ field ของ Jagota เลย ส่วน field mapping อยู่ใน `erp-payload.parsers.ts` ที่เดียว
  เหตุผล: ERP contract ยังไม่นิ่ง (ยังไม่ launch) พอ ERP เปลี่ยน spec ต้องแก้ที่เดียว
- ทุก ingest ผ่าน `sync-job` เสมอ — ห้ามเรียก write ตรงโดยไม่มี retry
- ทุก external id ต้องผ่าน `integration/mapping` ห้าม hardcode การ join ด้วย SKU string ในหลายที่

---

## 4. สถานะปัจจุบันของ repo นี้

| ของ | สถานะ |
|---|---|
| `integration/sync-job/` (BullMQ retry + log) | ✅ พร้อมใช้ |
| `integration/webhook-subscription/` (delivery worker) | ✅ พร้อมใช้ |
| `integration/mapping/` | ✅ พร้อมใช้ |
| `integration/adapter/` (`BaseCommerceAdapter`) | ✅ พร้อมใช้ |
| `commerce/warehouse` + `commerce/inventory` (`inventory_levels`) | ✅ มีโมเดลต่อคลังแล้ว |
| `commerce/reservation` | ✅ มี `reserved` ใน `inventory_levels` |
| `connector/erp/ingest/` (`erp-payload.parsers.ts`, `erp-ingest.service.ts`) | 🟡 มีบางส่วน — parse ได้แค่ product / stock / customer / sale-order · staging + ownership rules มีแล้วแต่ยังไม่มีกฎ draft / ห้ามทับชื่อ (ดู Task 3) |
| `ErpConnector.createOrder()` | ❌ mock — คืน `'erp order push not wired'` |
| `ErpHttpClient` | ❌ ชี้ `/api/v1/orders` ซึ่งไม่ใช่ Jagota Node API |
| Inbound route รับ webhook จาก ERP | ❌ ยังไม่มีเลย |
| EC2 / ECR ของ repo นี้ | ❌ ยังไม่ provision (ดู README "One-time setup — not yet done") |

> ⚠️ ตอนเช็คพบว่ามีไฟล์ค้าง uncommitted อยู่ใน `commerce/order/` และ `commerce/reservation/` (order-checkout.saga, route-lines, reservation.facade) — เคลียร์ก่อนเริ่มงานนี้

---

## 5. สัญญากับทีม ERP — ห้ามเปลี่ยนแม้แต่ตัวอักษรเดียว

- field เป็น **UPPER_SNAKE** ทั้งหมด: `DOC_BOOK`, `DOC_NO`, `SEQ_NO`, `PRODUCT_CODE`, `ORDERED_QUANTITY`, `PRODUCT_NAME_E/T`
- URL ที่ ERP ยิงต้องเหมือนเดิม — สลับปลายทางที่ nginx เอา ไม่ใช่เปลี่ยน path
- auth header เดิม: `X-ERP-Key`
- response เดิม: `{ received: true }`
- ตอน copy DTO จาก `josh/apps/backend/src/app/erp/dto/erp-webhook.dto.ts` **เปลี่ยนแค่ namespace** ห้ามเปลี่ยนชื่อ field ห้าม normalize เป็น camelCase
- **copy จาก `origin/main` ล่าสุดเท่านั้น** — DTO เปลี่ยนหลัง 09-01 แล้ว เช่น shape จริงของ `quotation.status.changed` (`a921afcfc`)

### Route inbound ที่มีจริงใน josh (`erp-webhook.controller.ts`, 2026-10-03)

| กลุ่ม | Route | Task |
|---|---|---|
| Stock/price/moq | `PUT /erp/products/qty`, `PUT /erp/products/price`, `PUT /erp/products/moq` | 2 |
| Product | `GET /erp/products`, `POST /erp/products`, `POST /erp/products/bulk`, `PUT /erp/products/image` | 3 |
| Customer/company | `POST /erp/customers`, `PUT /erp/customers`, `POST /erp/companies` | 4 |
| Order period / calendar | `POST /erp/order-periods`, `PUT /erp/order-periods`, `POST /erp/delivery-calendar/probe`, `POST /erp/sku-order-period/probe` | 6 |
| Order/invoice/quotation | `POST`+`PUT /erp/orders/status`, `POST`+`PUT /erp/invoices/status`, `POST`+`PUT /erp/quotations`, `POST`+`PUT /erp/quotations/status` | 7 |

รวม 22 route (POST กับ PUT ของ path เดียวกันต้องรับทั้งคู่) · **ไม่มี `/erp/categories*` แล้ว** — ถูกลบใน `f418ba325` เพราะ ERP sync แค่ SKU/price/qty · route ใต้ `/erp/testing/*` เป็น simulator ไม่ใช่ contract

---

## 6. Task list

### Task 1 — ล็อก internal API contract (ทำก่อนเขียนโค้ดบรรทัดแรก)

**ทำอะไร:** ตกลงกับฝั่ง josh ว่า commerce จะเรียกอะไรกลับไป mutate ข้อมูลของ shop

- นิยาม endpoint: **stage ERP product/price change** (เข้า staging ให้ MER approve ที่ web-admin), set stock, set order period / delivery date, update order status, upsert customer
- auth: shared secret (ไม่ใช่ public route)
- **idempotency key ทุก request** — ERP ยิงซ้ำได้ commerce retry ได้ ปลายทางต้องกันซ้ำเองได้
- นิยามว่า fail แล้วตอบอะไร → commerce ต้องแยก "retry ได้" ออกจาก "retry ไปก็ไม่ขึ้น" (4xx vs 5xx)

**เสร็จเมื่อ:** มีเอกสาร contract 1 ไฟล์ที่ทั้งสอง repo อ้างอิงตรงกัน
**เวลา:** 3-5 วัน

---

### Task 2 — Inbound: stock / price / moq

**ทำอะไร:** รับ 3 route แรกจาก ERP

- `PUT /erp/products/qty`
- `PUT /erp/products/price`
- `PUT /erp/products/moq`

**ประเด็นสำคัญ — ใส่ warehouse dimension ตั้งแต่ตอนนี้**
ERP วันนี้ส่งคลังเดียว แต่ให้ parser รับ warehouse ได้เลย แล้ว map ลง `inventory_levels(product_id, warehouse_id, …)` โดยใช้ default warehouse ไปก่อน — ตอนนี้ต้นทุนเกือบศูนย์ แต่ประหยัดการรื้อรอบใหญ่ทีหลัง

**ต้องทำ:**
- controller + DTO ใน `integration/connector/erp/presentation/` (copy DTO จาก josh)
- ขยาย `erp-payload.parsers.ts`
- เขียนลง `inventory_levels`
- **write-through กลับ shop**: Redis `jagota:sellable:<sku>` + Postgres ของ shop ผ่าน internal API
- ผ่าน `sync-job` เพื่อให้ retry ได้ — josh มีคิวของตัวเองแล้ว (`erp-inbound-enqueuer.service.ts` + `erp-inbound-queue.processor.ts`) ให้อ่านเป็น reference ว่า dedupe/retry อะไรไว้บ้าง แต่ไม่ต้อง copy queue มา
- **price ส่งเข้า staging ของ josh** ไม่เขียน live ทันที (ดู Task 3) — qty/moq เขียน live ได้

**เสร็จเมื่อ:** ยิง payload จริงของ ERP เข้ามาแล้ว `inventory_levels` อัปเดต และ shop อ่านค่าใหม่ได้ · retry ทำงานเมื่อ internal API ล้ม
**เวลา:** 3-4 วัน

---

### Task 3 — Inbound: product / category

**ทำอะไร:**
- `GET /erp/products`, `POST /erp/products`, `POST /erp/products/bulk`, `PUT /erp/products/image`
- ~~`/erp/categories*`~~ — **ตัดออก** josh ลบไปแล้วใน `f418ba325` (category เป็นของ shop ไม่ได้มาจาก ERP)

`ProductUpsertDto` มี ~40 field (`PRODUCT_NAME_E/T`, `BRAND`, `UNIT`, `UNIT_PER_BOX`, `PACK_SIZE`, `TEMPERATURE`, `NUTRITION_CONTENT`, `ORDERING_OPTIONS`, `COUNTRY_CODE`, …)

**แบ่งงาน — MER approve ที่ web-admin ของ josh ที่เดียว:**
- **commerce:** รับ webhook → parse → dedupe → audit → ส่ง product/price change เข้า **staging ของ josh** ผ่าน internal API (endpoint "stage ERP change" ใน contract ของ Task 1) · ต้องส่ง source `product` / `price` / `product+price` ไปด้วย
- **josh (ไม่ย้าย):** staging (`erp-pending-change.helper.ts`), หน้า approve ของ MER (`AllProduct.tsx`), competitor-prices ที่ MER ใช้เทียบราคาตอน approve
- staging/review ของ commerce-admin (C3b-T10) **ไม่ใช้เป็นหน้า approve ของ MER** — ใช้ดู audit/retry ของ ingest สำหรับ dev/ops เท่านั้น

**กฎที่ josh เพิ่มหลัง 09-01 — บังคับใช้ตอนเขียนลง josh ฝั่ง commerce ห้ามทำซ้ำ แค่ห้ามตัด field ทิ้ง:**
- product/price จาก ERP เข้า staging รอ MER approve ก่อนขึ้น live (`1e32089e8`)
- product ที่ ERP สร้างใหม่ **เริ่มเป็น draft** admin ต้อง approve (`f83054562`)
- **ห้ามเขียนทับ** `PRODUCT_NAME_E/T` และ description ของสินค้าที่มีอยู่แล้ว (`aff4777d0`)
- ERP เขียน product status ได้เฉพาะบางสถานะ (`shared/helpers/product-status.helper.ts`)
- pack/ordering unit normalize ที่ josh (`erp-order-unit.helper.ts`, `erp-pack-sync.helper.ts`)

**เจ้าของข้อมูล:** product master + staging + approve เป็นของ shop — commerce เก็บแค่ mapping + audit

**เวลา:** 3-4 วัน (category ตัดออก, staging ไม่ต้องทำฝั่งนี้)

---

### Task 4 — Inbound: customer / company

- `POST /erp/customers`, `PUT /erp/customers`
- `POST /erp/companies`

ใช้ `integration/mapping` เก็บคู่ external id ↔ shop id

**ขาออก (shop → ERP) ที่ josh ย้ายขึ้น BullMQ แล้ว (`4a06d43ff`)** — ต้นทาง `erp-customer-jobs.service.ts`, `erp-customer-queue.processor.ts`, `jagota-customer-sync.service.ts` ระวังเรื่องที่ josh แก้ไปแล้ว:
- business customer ต้องรอ company สร้างเสร็จก่อน (`0719a10f0`)
- create-customer timeout กลาง registration (`e08015c10`)
- เก็บ INA code จริง และ email ตอนสมัครยาวได้ไม่เกิน 50 ตัวอักษร (`6d5a62404`)

**เวลา:** 2-3 วัน

---

### Task 5 — Outbound: Jagota connector จริง

**ทำอะไร:** แทนที่ mock ปัจจุบัน

- `ErpHttpClient` ต้องชี้ Jagota Node API ไม่ใช่ `/api/v1/*` ที่เป็น stub
- implement `ErpConnector.createOrder()` ให้ยิง `POST /order/add-order-create` จริง แล้วเก็บ `DOC_BOOK` / `DOC_NO` กลับมา
- เส้นที่ต้องย้าย (นับจาก `jagota-order/` ณ 2026-10-03):

| กลุ่ม | Path |
|---|---|
| Order/quotation | `/order/add-order-create`, `/order/cancel-josh-stock-order`, `/quotation/create` |
| Customer/branch | `/customers/create-customer`, `/customers/match-existing`, `/customers/registration/*`, `/branch/create-branch`, `/branch/get-branch-by-magento-id` |
| Product read | `/products/get-order-periods`, `/products/get-product-order-period`, `/products/get-product-season`, `/products/get-customer-special-price`, `/products/<sku>/delivery-date` |
| Finance read | `/finance/get-customer-info` |

- **ไม่ย้าย** (อยู่ josh — ผูก payment/billing): `/payment/*`, `get_josh_payment`, invoice QR, `/finance/get-billing-list`, `/finance/get-customer-invoice-list`, `/finance/get-payment-history`
  - ทั้งสองฝั่งจะเรียก Jagota Node API → **auth token ต้องมีเจ้าของเดียว** (ดู Task 6) ฝั่ง josh ต้องขอ token จาก commerce หรือแชร์ผ่าน Redis
- ต้นทาง logic: `jagota-node-api.service.ts` (client), `jagota-order.service.ts` → `submitCreateOrderToJagota()`, `jagota-quotation.service.ts`, `jagota-branch-sync.service.ts`
- `/order/add-order-create` ใช้ shipment number เป็น `P_DOCUMENT` (`a1e9f5bd6`)

**ระวัง:** auth token ของ Jagota มี cron refresh (`jagota-auth-token.cron.ts`) ย้ายมาด้วยใน Task 6 — ระหว่างนี้อย่าให้รันซ้อนสองฝั่ง

**เวลา:** 4-5 วัน

---

### Task 6 — Cron + order period / delivery calendar

**Cron ที่ต้องย้าย:**
- `jagota-auth-token.cron.ts`
- `jagota-branch-status.cron.ts`
- `supplier-order-period-poll.cron.ts` — group sync ตาม SUP, gate ด้วย `ORDER_PERIOD` (`442913c0e`)
- `sku-order-period-probe.cron.ts`
- `delivery-calendar-probe.cron.ts`
- `jagota-delivery-date-cache.cron.ts`

**Inbound ที่ไปด้วยกัน:** `POST`+`PUT /erp/order-periods`, `POST /erp/delivery-calendar/probe`, `POST /erp/sku-order-period/probe`

**ประเด็นสำคัญ:** order period กับ delivery date ถูก checkout ของ shop อ่านทุกครั้ง → commerce ทำแค่ probe/poll/รับ webhook แล้ว **write-through ลง Redis/Postgres ของ shop** แบบเดียวกับ stock ใน Task 2 ห้ามให้ checkout เรียกข้ามมาที่นี่

**สำคัญ:** ปิดฝั่ง `josh/apps/backend` ด้วย env flag **ทันที** ที่ฝั่งนี้ขึ้น ห้ามเปิดทิ้งไว้ทั้งคู่ — schedule และ env ของ josh ย้ายไปรวมที่ `src/config` แล้ว (`4b236da02`) ให้ใส่ flag ที่นั่น

**เวลา:** 4-5 วัน (เพิ่มจาก 2-3 วัน เพราะมี cron order period / delivery เพิ่มมา)

---

### Task 7 — Inbound: order / quotation lifecycle (ยากสุด ทำท้ายสุด)

- `POST`+`PUT /erp/orders/status`
- `POST`+`PUT /erp/invoices/status`
- `POST`+`PUT /erp/quotations`
- `POST`+`PUT /erp/quotations/status`

ผูกกับ order lifecycle + sellable stock ของ shop

**ต้อง idempotent จริง** — ERP ยิงซ้ำได้ และ status อาจมาไม่เรียง ต้องกัน status เก่าทับ status ใหม่ · josh เข้าคิว + dedupe เส้นพวกนี้แล้ว (`299de0ffb`) ให้ใช้เป็น reference

**แบ่งงาน:** commerce รับ webhook, dedupe, เก็บ audit, map `DOC_BOOK`/`DOC_NO` แล้วส่ง status ผ่าน internal API · **ผลกับ order ยังเป็น logic ของ josh** ได้แก่ auto-resume `payment_pending` เมื่อ quotation approve (`80af640a3`), invoice credit-term ยังเป็น unpaid (`71dcf7dfe`), credit back ต่อ shipment, notification

**สิ่งที่ต้องรักษาไว้:**
- backfill `DOC_BOOK`/`DOC_NO` จาก orders/status ถ้า push ตอนแรกไม่ได้กลับมา (`81fb86ccf`)
- quotation status ใช้ shape จริงของ ERP (`a921afcfc`)
- quotation ที่ยัง pending ต้อง tag เป็น `sync_status = pending` (`44d5018e7`)

**เวลา:** 4-5 วัน

---

### Task 8 — Reliability + wiring

- Dead-letter queue + alert เมื่อ ingest ล้มเกิน N ครั้ง (ห้ามให้ webhook หายเงียบ — josh เข้าคิวบางเส้นแล้ว แต่ยังไม่มี DLQ/alert)
- nginx route `/api/erp/*` → commerce-platform (ยกเว้น `/api/3pl/*` ที่ยังอยู่ josh)
- **ย้าย ERP Webhook Simulator มาด้วย** (`erp-webhook-simulator.controller.ts` + guard, `6412c0566`, `b2c4ec965`) — ยิงได้ครบทุก inbound route + mock ต่อ account สำหรับ full-loop test · ต้องมี kill-switch ปิดใน prod (`122d707c1`) · หน้า console ย้ายไป commerce-admin
  - ส่วนที่ preview credit back / shipment ของ simulator อ่านข้อมูล order ของ shop → เหลือไว้ใน josh หรือเรียกผ่าน internal API
- Smoke test ครบทุก route ด้วย payload จริงจากทีม ERP (ใช้ simulator ข้างบน)
- **Provision EC2 + ECR ของ repo นี้** (README บอกว่ายังไม่ทำ) — ต้องอยู่ **VPC เดียวกับ josh backend** ไม่งั้น latency ของ internal API call จะไม่ใช่ 1-3ms อีกต่อไป

**เวลา:** 4-6 วัน

---

## 7. เผื่ออนาคต — ทำตอนนี้เพราะถูกกว่าทำทีหลัง

| สิ่งที่เผื่อ | ทำใน task ไหน | ต้นทุนตอนนี้ |
|---|---|---|
| stock payload รับ `warehouse` ได้ | Task 2 | เกือบศูนย์ |
| เพิ่ม `country_code` + `currency` ใน `warehouses` (ตอนนี้มีแค่ `code`, `name`, `address`) | Task 2 | 1 migration |
| Redis sellable key เผื่อเป็น `<sku>:<warehouse>` พร้อม fallback คีย์เดิม | Task 2 | เล็ก |
| order line บันทึกว่าตัดจากคลังไหน | Task 1 (ใส่ใน contract) | เล็กถ้าใส่ตอนออกแบบ contract |

**ไม่ต้องทำในรอบนี้:** routing rule ว่า warehouse ไหน serve branch ปลายทางไหน — ยังไม่มีทั้งสองฝั่ง แค่ออกแบบ schema ให้ใส่เพิ่มได้ทีหลัง

---

## 8. ความเสี่ยง

| ความเสี่ยง | รับมือ |
|---|---|
| ERP contract ยังไม่นิ่ง (ยังไม่ launch) | แยก boundary ออกจาก field mapping — field mapping อยู่ในไฟล์ parser เดียว |
| Scope creep เข้า "ย้าย order มาทั้งหมด" | ยึดข้อ 1 "ไม่ใช่เป้าหมาย" — ถ้าต้องแตะ order/pricing ของ shop = ออกนอก scope |
| Data consistency ข้าม 2 DB | retry + DLQ ตั้งแต่ Task 2 ไม่ใช่ค่อยเติมทีหลัง |
| Cron รันซ้อนสองฝั่ง | ปิดฝั่ง josh ด้วย env flag ทันทีที่ฝั่งนี้ขึ้น |
| DTO drift ข้าม repo | test assert ชื่อ field ตรงตัวทั้งสองฝั่ง |
| latency ถ้า EC2 คนละ VPC | บังคับให้อยู่ VPC เดียวกัน — เช็คใน Task 8 |

---

## 9. เช็คก่อนเริ่ม

- [ ] ยืนยันกับทีม ERP ว่า 22 route (ตาราง §5) + payload นิ่งพอจะ implement (หรืออันไหนยังจะเปลี่ยน)
- [ ] ตกลงเจ้าของ Jagota auth token ตัวเดียว เพราะ payment/billing ของ josh ยังเรียก Jagota เองอยู่ (Task 5)
- [ ] ก่อนเริ่มแต่ละ task ให้ diff ต้นทางใน josh เทียบกับวันที่ในหัวเอกสาร
- [ ] เคลียร์ไฟล์ค้าง uncommitted ใน `commerce/order/`, `commerce/reservation/`
- [ ] ตกลงว่า commerce-platform รัน EC2 ตัวไหน และอยู่ VPC เดียวกับ josh backend
- [ ] ตกลงว่า `commerce_db` และ Redis ใช้ instance ร่วมกับ shop หรือแยก (ต้องเข้าถึง Redis ของ shop ได้ถ้าจะ write-through)
- [ ] มี dev bandwidth ต่อเนื่อง ~5-6 สัปดาห์ (migration แบบขาดตอนเสี่ยง drift สูง)

**รวมทั้งหมด ~6 สัปดาห์ dev เต็มเวลา** (Task 6 เพิ่ม ~2 วัน, Task 3 ลด ~1 วันเพราะ staging อยู่ josh)
