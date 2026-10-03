# ERP Integration — งานที่ต้องทำใน commerce-platform

> เขียน 2026-09-01 · อัปเดต 2026-10-03 ตาม josh `origin/main` @ `b5785c6ab` · ต้นทาง: `josh/docs/erp-requirements/erp-commerce-prelaunch-plan.html`
> Scope: commerce-platform เป็น hub รับ ERP แล้วกระจายให้ทุก platform (josh คือตัวแรก) · josh กับ commerce ล่มแยกกันได้ (§0) · ย้ายงานหนักออกจาก josh (Task 9)
> **ทำก่อน shop launch** — ไม่มี traffic จริง จึงไม่มี shadow mode / cutover / rollback plan

---

## 0. หลักข้อแรก — ตัวใดตัวหนึ่งตายได้ (ตัดสิน 2026-10-03)

**josh กับ commerce ต้องอยู่รอดได้เมื่ออีกฝั่งล่ม** ทุก design ในเอกสารนี้ต้องผ่านคำถาม 2 ข้อ:

1. **commerce ล่ม → josh ยังขายของได้ครบไหม?** ต้องได้ — josh ห้าม block รอ commerce ใน request path หรือ cron ที่ checkout พึ่ง
2. **josh ล่ม → ข้อมูลจาก ERP หายไหม?** ต้องไม่หาย — commerce เก็บไว้แล้วส่งซ้ำเมื่อ josh กลับมา

| เรื่อง | รูปแบบ | commerce ล่ม | josh ล่ม |
|---|---|---|---|
| ERP inbound | nginx ส่ง `/api/erp/*` → commerce ก่อน, **josh เป็น backup upstream** (route เดิมของ josh เก็บไว้ ไม่ลบ) | nginx สลับไป josh เอง — ไม่มี audit ฝั่ง commerce ช่วงนั้น | commerce เก็บลง staging + retry จน josh กลับมา |
| Logic ธุรกิจของ ERP (draft, staging MER, ห้ามทับชื่อ, sellable, restock notify) | **อยู่ josh ที่เดียว** — commerce ส่งต่อเข้า handler เดิมของ josh ผ่าน internal API | — | — |
| Outbound ไป Jagota (order push, customer sync) + cron ที่ checkout พึ่ง (auth token, order period, delivery date) | **อยู่ josh** — josh มีคิว `order-erp` / `erp-customer` ของตัวเองอยู่แล้ว | ไม่กระทบ | — |
| งานหนัก (report/metrics, export/archive, cache warmup/facet) | **commerce คำนวณ แล้วเขียนผลกลับ** Redis/ตาราง read-model ของ josh | josh ใช้ผลล่าสุดต่อ (stale) — ห้าม fallback ไปคำนวณเองใน request | commerce เก็บผลไว้ เขียนกลับเมื่อ josh กลับมา |

### 0.1 commerce เป็น hub — josh คือ platform แรก ไม่ใช่ตัวเดียว (ตัดสิน 2026-10-03)

platform อื่นในอนาคต (ร้าน/ช่องทางขายใหม่) ต้องมาใช้ commerce ได้โดย **ไม่ต้องแก้โค้ดของ commerce** ดังนั้นห้าม hardcode "ส่งให้ josh" ที่ไหน:

```
ERP ──► commerce (stage · inventory ต่อคลัง · audit) ──► canonical event ──► webhook subscription ของแต่ละ platform
                                                                              ├─► josh   (/api/internal/erp/…)
                                                                              └─► platform ถัดไป (สมัครเองผ่าน portal)
```

- ใช้ของที่มีอยู่: `integration/webhook-subscription` (secret + HMAC `x-signature`, retry 5 ครั้ง, `x-delivery-id`) + portal (API key, สมัคร webhook เอง)
- event เป็น **canonical** (`inventory.qty.changed`, `product.price.changed`, `product.moq.changed`, …) payload = `{ type, aggregateId, data }` โดย `data` คือ item ของ ERP ตามที่ได้รับ — platform ไหนจะ map field เองฝั่งตัวเอง
- platform อ่านสต็อก/ข้อมูลผ่าน storefront API (`X-Api-Key`) ที่มีอยู่
- platform หนึ่งล่ม → delivery ของ platform นั้น retry/เข้า dead-letter เอง ไม่กระทบ platform อื่น
- **ผลกับ ERP:** response ตอบ `{ received: true }` ทันทีหลัง stage (ตาม §5) — ไม่รอผลจาก platform ใด · ⚠️ ปัจจุบัน josh ตอบ `updated`/`failed` เพิ่มด้วย ต้องยืนยันกับทีม ERP ว่าไม่ได้ใช้

### 0.2 อนาคต: ระบบคลังของเราเอง (หลัง MER clean inventory เสร็จ)

วันนี้ ERP เป็นเจ้าของตัวเลขสต็อก commerce แค่เก็บตาม · วันหน้า **commerce จะเป็นระบบคลังเอง** (รับเข้า ปรับยอด โอนคลัง นับสต็อก) — ทำ 3 อย่างตั้งแต่ Task 2 เพราะตอนนี้ถูก:

1. **เก็บเป็น ledger ไม่ใช่แค่เขียนทับ** — ทุกการเปลี่ยน qty ลง `inventory_movements(product_id, warehouse_id, source, reason, quantity_after, ref, occurred_at)` แล้วค่อยอัปเดต snapshot ใน `inventory_levels` · ERP ส่ง `REASON` (SALE / RECEIVE / ADJUST) กับ `CHANGED_AT` มาอยู่แล้ว เก็บไว้เลย → พอเป็นระบบคลังเองจะมีประวัติย้อนหลังและ reconcile กับ ERP ได้
2. **เจ้าของสต็อกระบุต่อคลัง** — `warehouses.stock_source = 'erp' | 'commerce'` (วันนี้ทุกคลัง = `erp`) · ย้ายทีละคลังได้หลัง clean เสร็จ ไม่ต้องสลับทั้งระบบทีเดียว · คลังที่ source = `commerce` จะไม่รับ qty จาก ERP มาเขียนทับ (เก็บเป็น movement `ignored` ไว้เทียบ)
3. **event ไม่เปลี่ยนตาม source** — platform ได้ `inventory.qty.changed` เหมือนเดิมไม่ว่าเลขมาจาก ERP หรือระบบคลังเรา → **วันสลับ josh ไม่ต้องแก้อะไร** (ได้จาก hub ใน §0.1)

**ยังไม่ทำตอนนี้ (ทำตอนสลับจริง):** หน้าจอรับเข้า/นับ/โอนคลัง · ส่งยอดจากเรากลับ ERP (บัญชีอาจยังต้องใช้) · ตัดสต็อกตอนขายผ่าน `commerce/reservation` ที่มีอยู่ · UI ระบบคลังอยู่ใน repo นี้ (`apps/warehouse-web` ใน josh เป็นแค่ scaffold ว่าง)

**ผลที่ตามมา:** commerce **ไม่เคยอยู่ใน request path ของ shop** · josh เรียก commerce ได้เฉพาะแบบ fire-and-forget/async ที่ล้มได้ · ทุกอย่างที่ commerce เขียนกลับ josh ต้อง idempotent

---

## 1. เป้าหมาย และไม่ใช่เป้าหมาย

**เป้าหมาย**

- commerce-platform เป็นด่านหน้ารับ ERP (josh เป็นสำรอง) — buffer, audit, retry, dead-letter ให้ทุก webhook ไม่หายเงียบแม้ josh ล่ม
- commerce-platform เป็นเจ้าของ **inventory ต่อคลัง** (`inventory_levels`) ซึ่ง `josh/apps/backend` ไม่มีโมเดลนี้
- **ย้ายงานหนักออกจาก josh** — คำนวณที่ commerce แล้วเขียนผลกลับ เพื่อ performance ของ josh (เลือกจากผลวัดจริง ดู Task 9)
- ทุก ingest มี retry + audit trail

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
| ERP inbound (buffer, audit, retry, dead-letter, mapping) | **commerce-platform** | josh เป็น backup upstream |
| ERP business logic + outbound ไป Jagota + cron ที่ checkout พึ่ง | **josh/apps/backend** | ต้องทำงานได้ตอน commerce ล่ม (§0) |
| งานหนักที่ไม่อยู่ใน request path | **commerce-platform** | เขียนผลกลับ josh, josh ใช้ค่าล่าสุดถ้า commerce ล่ม |
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
| Inbound webhook ERP — **copy** (route ของ josh เก็บไว้เป็น backup) | `erp/erp-webhook.controller.ts`, `erp-key.guard.ts`, `data-envelope.pipe.ts`, `single-or-array.pipe.ts`, `dto/` | `integration/connector/erp/presentation/` | 2,3,4,7 |
| Buffer + retry + dead-letter ของ inbound | (josh มี `erp-inbound-queue` เป็น reference) | `ErpIngestRecord` + คิว forward ของ commerce | 2 |
| Inventory ต่อคลัง (shadow ของ qty ที่ ERP ส่ง) | — (josh ไม่มี) | `commerce/inventory` | 2 |
| ERP Webhook Simulator + mock ต่อ account | `erp/erp-webhook-simulator.controller.ts`, `erp-webhook-simulator.guard.ts` | `connector/erp` (dev/staging เท่านั้น มี kill-switch prod) + หน้าใน commerce-admin | 8 |
| งานหนัก (รอผลวัด) | report/metrics, export/archive, cache warmup/facet — ดู Task 9 | `platform/offload` (ใหม่) | 9 |

### ไม่ย้าย — อยู่ josh ต่อ

| ฟีเจอร์ | เหตุผล |
|---|---|
| **Handler ธุรกิจของ ERP** (`erp-webhook.service.ts`: qty/price/moq/product/customer/order status) | commerce ส่งต่อเข้า handler เดิม — logic มีที่เดียว ไม่ drift และ josh ยังรับ ERP เองได้ตอน commerce ล่ม |
| Stock + sellable (`jagota-stock.service.ts`, `sellable-stock.service.ts`) | Redis sellable อ่านทุก PLP/cart — ต้องอัปเดตได้แม้ commerce ล่ม |
| Outbound Jagota (`jagota-node-api.service.ts`, order/quotation push, customer/branch sync) | checkout ต้อง push order ได้ตอน commerce ล่ม · josh มีคิว `order-erp` / `erp-customer` อยู่แล้ว |
| Cron ที่ checkout พึ่ง (auth token, branch status, order period, delivery calendar/date) | ถ้าย้ายแล้ว commerce ล่ม → checkout คำนวณวันส่ง/รอบสั่งไม่ได้ |
| Payment/billing ที่เรียก Jagota (`get_josh_payment`, invoice QR, KBank notify relay, `/payment/*`, `jagota-finance.service.ts` ส่วนที่ใช้ตอนจ่าย) | ผูก payment ของ shop — §1 ห้ามแตะ |
| Credit back / credit note, invoice line (`erp-invoice-line.*`) | ผูก order/billing ของ shop |
| ผลของ order/invoice status ที่ไปแก้ order ของ shop (auto-resume `payment_pending`, credit-term unpaid, notification) | commerce แค่รับ webhook + dedupe แล้วส่ง status ผ่าน internal API — logic ฝั่ง order ยังอยู่ josh |
| 3PL delivery-status (`/3pl/delivery-status`) | มาจาก 3PL ไม่ใช่ ERP |
| Shipment tracking (`shipment-tracking.service.ts`, `GET /drivers/tracking`) | read-through cache ที่ลูกค้าเรียกตรงจาก shop — ย้ายมาจะเพิ่ม network hop (cron poll GPS ถูกลบไปแล้วใน `4e7951b5e`) |
| Staging product/price รอ MER approve (`erp/erp-pending-change.helper.ts`, approve ที่ `product.controller.ts` + web-admin `AllProduct.tsx`) | **MER ทำงานที่ web-admin ที่เดียว** — commerce ส่ง change เข้า staging ของ josh ผ่าน internal API ไม่เปิดหน้า approve ซ้ำใน commerce-admin |
| competitor-prices / scraping | MER ใช้คู่กับ approve ราคาใน web-admin + join `ProductInventory` ของ shop โดยตรง — แยกออกมาจะทำให้ MER ทำงาน 2 ที่ |
| หน้าจอ/workflow ของ marketing-* และ cache ใน request path | อยู่ josh — ส่วนที่เป็นงานคำนวณหนักเบื้องหลังย้ายได้ใน Task 9 |

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

**ทำอะไร:** ล็อก **event contract** ที่ commerce ส่งให้ทุก platform (josh เป็นคนแรก) — ไม่ใช่ API เฉพาะ josh (§0.1)

- **event catalog:** ERP route → canonical event type (`inventory.qty.changed`, `product.price.changed`, `product.moq.changed`, …) · 1 event ต่อ 1 SKU
- **envelope:** `{ type, aggregateId: <PRODUCT_CODE>, data: <ERP item ตามที่ได้รับ> }` · header `x-event-type`, `x-delivery-id` (= idempotency key), `x-signature` (HMAC-SHA256 ด้วย secret ของ subscription)
- **ผู้รับต้อง:** ตรวจ signature · กันซ้ำด้วย `x-delivery-id` (เช่น Redis TTL 24 ชม.) · ตอบ `2xx` = รับแล้ว · `4xx` = ไม่ retry (payload ผิด / SKU ไม่มี) · `5xx`/timeout = retry
- **josh:** เปิด `POST /api/internal/erp-events` 1 เส้น → แกะ `data` แล้วเรียก **handler ตัวเดียวกับ** `/api/erp/<path>` (logic อยู่ที่เดียว §0) · สมัครเป็น subscription ใน commerce
- **กัน out-of-order:** commerce ไม่ส่ง event ของ SKU+type ที่มี event ใหม่กว่าส่งสำเร็จแล้ว (`superseded`)
- **แก้ใน commerce:** delivery worker ปัจจุบัน retry ทุก non-2xx → ต้องหยุดที่ 4xx (ยกเว้น 408/429)

**เสร็จเมื่อ:** `docs/event-contract.md` (ใช้กับทุก platform) + josh ทำตาม
**เวลา:** 1-2 วัน

---

### Task 2 — Inbound: stock / price / moq

**ทำอะไร:** รับ 3 route แรกจาก ERP

- `PUT /erp/products/qty`
- `PUT /erp/products/price`
- `PUT /erp/products/moq`

**ประเด็นสำคัญ — ใส่ warehouse dimension ตั้งแต่ตอนนี้**
ERP วันนี้ส่งคลังเดียว แต่ให้ parser รับ warehouse ได้เลย แล้ว map ลง `inventory_levels(product_id, warehouse_id, …)` โดยใช้ default warehouse ไปก่อน — ตอนนี้ต้นทุนเกือบศูนย์ แต่ประหยัดการรื้อรอบใหญ่ทีหลัง

**ต้องทำ (commerce):**
- controller + DTO ใน `integration/connector/erp/presentation/` (copy DTO จาก josh)
- parser Jagota ใน `erp-payload.parsers.ts` (ของเดิมเป็นชื่อ field Oracle EBS — คนละรูปแบบ)
- stage 1 `ErpIngestRecord` ต่อ SKU → qty ลง `inventory_movements` (source `erp`, เก็บ `REASON`/`CHANGED_AT`) แล้วอัปเดต `inventory_levels` ของ default warehouse · ข้ามถ้าคลังนั้น `stock_source = 'commerce'` (§0.2)
- migration: ตาราง `inventory_movements` + คอลัมน์ `warehouses.stock_source` (default `'erp'`)
- publish canonical event → webhook subscription ส่งให้ทุก platform ที่สมัคร · ตอบ ERP `{ received: true }` ทันทีหลัง stage
- **ไม่เขียน Redis ของ shop เอง** — handler ของ josh ทำ sellable, cache facet, restock notify ให้อยู่แล้ว
- price ไป staging ของ josh เพราะ handler เดิมทำแบบนั้น — commerce ไม่ต้องรู้

**ต้องทำ (josh):** `POST /api/internal/erp-events` + ตรวจ signature + idempotency (Task 1) · สมัคร subscription

**เสร็จเมื่อ:** ยิง payload จริงเข้า commerce แล้ว `inventory_levels` + shop อัปเดต · ปิด josh แล้วยิง → ค่าไปถึง shop เมื่อ josh กลับ · ปิด commerce แล้วยิงผ่าน nginx → josh รับเองได้ · เพิ่ม subscription ปลอมตัวที่ 2 แล้วได้ event เหมือนกันโดยไม่แก้โค้ด
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

**ขาออก (shop → ERP) อยู่ josh ต่อ** (§0) — `erp-customer` queue ของ josh ต้องทำงานได้ตอน commerce ล่ม

**เวลา:** 2-3 วัน

---

### Task 5 — ~~Outbound: Jagota connector~~ → ยกเลิก อยู่ josh ต่อ

ตัดสินตาม §0: checkout ของ josh ต้อง push order / quotation / customer ไป Jagota ได้ตอน commerce ล่ม และ josh มีคิว `order-erp` / `erp-customer` ที่ retry เองอยู่แล้ว · ย้ายมาจะทำให้ commerce อยู่ใน critical path ของการขาย

- `ErpHttpClient` / `ErpConnector.createOrder()` ของ repo นี้ **คงเป็น mock** — ไม่ wire กับ Jagota
- Jagota auth token มีเจ้าของเดียวคือ josh — commerce ไม่เรียก Jagota Node API เลยในรอบนี้
- ถ้าวันหน้าต้องการ audit ขาออก: josh ส่ง event แบบ fire-and-forget มาให้ commerce เก็บ (ล้มได้ ไม่กระทบ checkout)

---

### Task 6 — Inbound: order period / delivery calendar (cron อยู่ josh)

- **ส่งต่อ** `POST`+`PUT /erp/order-periods`, `POST /erp/delivery-calendar/probe`, `POST /erp/sku-order-period/probe` แบบเดียวกับ Task 2
- **cron ทั้งหมดอยู่ josh** (`jagota-auth-token`, `jagota-branch-status`, `supplier-order-period-poll`, `sku-order-period-probe`, `delivery-calendar-probe`, `jagota-delivery-date-cache`) — checkout อ่านผลทุกครั้ง ถ้าย้ายแล้ว commerce ล่ม checkout คำนวณวันส่ง/รอบสั่งไม่ได้
- ไม่ต้องมี env flag ปิดสองฝั่ง เพราะไม่มีการรันซ้อน

**เวลา:** 1-2 วัน (จาก 4-5 วัน)

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
- nginx route `/api/erp/*` → commerce-platform เป็น primary, **josh เป็น `backup` upstream** (`proxy_next_upstream error timeout http_502 http_503 http_504`) · `/api/3pl/*` ไป josh ตรง
- **ซ้อมล่ม 2 ทาง ก่อน launch:** (1) stop commerce → ERP ยิงแล้ว josh รับ, shop อัปเดต (2) stop josh → ERP ได้ `queued`, เปิด josh กลับ → ค่าไปถึง shop ครบ ไม่ซ้ำ
- **ย้าย ERP Webhook Simulator มาด้วย** (`erp-webhook-simulator.controller.ts` + guard, `6412c0566`, `b2c4ec965`) — ยิงได้ครบทุก inbound route + mock ต่อ account สำหรับ full-loop test · ต้องมี kill-switch ปิดใน prod (`122d707c1`) · หน้า console ย้ายไป commerce-admin
  - ส่วนที่ preview credit back / shipment ของ simulator อ่านข้อมูล order ของ shop → เหลือไว้ใน josh หรือเรียกผ่าน internal API
- Smoke test ครบทุก route ด้วย payload จริงจากทีม ERP (ใช้ simulator ข้างบน)
- **Provision EC2 + ECR ของ repo นี้** (README บอกว่ายังไม่ทำ) — ต้องอยู่ **VPC เดียวกับ josh backend** ไม่งั้น latency ของ internal API call จะไม่ใช่ 1-3ms อีกต่อไป

**เวลา:** 4-6 วัน

---

### Task 9 — ย้ายงานหนักออกจาก josh (offload)

**ทำอะไร:** commerce รันงานหนักที่ไม่อยู่ใน request path แล้วเขียนผลกลับ josh

**กลุ่มที่เลือก (2026-10-03):** report/metrics, export/archive, cache warmup/facet — **เลือกตัวจริงจากผลวัด** ไม่ใช่จากชื่อ

**กฎ:**
- commerce อ่าน DB ของ josh ผ่าน **read replica** (ไม่แย่ง primary) แล้วเขียนผลกลับผ่าน internal API หรือ Redis key ที่ตกลงกัน
- ผลทุกตัวมี `computed_at` — josh แสดงค่าล่าสุดเสมอ ถ้าเก่าเกินกำหนดแค่ log/alert **ห้ามคำนวณเองใน request**
- cron ฝั่ง josh ของงานที่ย้ายแล้วใช้ lock ร่วม (`CronLockService` ของ josh) — commerce ถือ lock ตามปกติ, josh รันแทนเฉพาะเมื่อ heartbeat ของ commerce หายเกิน N นาที (ตัวเลือก ถ้างานนั้นห้าม stale นาน)

**ขั้นตอน:** วัด slow query / เวลา cron จริง → เลือก 2-3 ตัวแรก → ย้ายทีละตัว วัดก่อน/หลัง

**เวลา:** ประเมินหลังได้ผลวัด

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
| ฝั่งหนึ่งล่มแล้วอีกฝั่งพังตาม | §0 + ซ้อมล่ม 2 ทางใน Task 8 · commerce ไม่อยู่ใน request path ของ shop |
| ERP ใช้ `updated`/`failed` ใน response ที่ josh ตอบอยู่ | ยืนยันกับทีม ERP ก่อน Task 2 ขึ้น (commerce ตอบแค่ `received`) |
| DTO drift ข้าม repo | test assert ชื่อ field ตรงตัวทั้งสองฝั่ง |
| latency ถ้า EC2 คนละ VPC | บังคับให้อยู่ VPC เดียวกัน — เช็คใน Task 8 |

---

## 9. เช็คก่อนเริ่ม

- [ ] ยืนยันกับทีม ERP ว่า 22 route (ตาราง §5) + payload นิ่งพอจะ implement (หรืออันไหนยังจะเปลี่ยน)
- [ ] ยืนยันกับทีม ERP ว่าไม่ได้อ่าน `updated`/`failed` จาก response
- [ ] มี read replica ของ DB josh ให้ commerce อ่านงานหนัก (Task 9)
- [ ] ก่อนเริ่มแต่ละ task ให้ diff ต้นทางใน josh เทียบกับวันที่ในหัวเอกสาร
- [ ] เคลียร์ไฟล์ค้าง uncommitted ใน `commerce/order/`, `commerce/reservation/`
- [ ] ตกลงว่า commerce-platform รัน EC2 ตัวไหน และอยู่ VPC เดียวกับ josh backend
- [ ] ตกลงว่า `commerce_db` และ Redis ใช้ instance ร่วมกับ shop หรือแยก (ต้องเข้าถึง Redis ของ shop ได้ถ้าจะ write-through)
- [ ] มี dev bandwidth ต่อเนื่อง ~5-6 สัปดาห์ (migration แบบขาดตอนเสี่ยง drift สูง)

**รวม Task 1-8 ~4 สัปดาห์** (Task 5 ยกเลิก, Task 6 เหลือ 1-2 วัน) · Task 9 ประเมินหลังได้ผลวัด
