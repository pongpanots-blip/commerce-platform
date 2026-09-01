# ERP Integration — งานที่ต้องทำใน commerce-platform

> เขียน 2026-09-01 · ต้นทาง: `josh/docs/erp-requirements/erp-commerce-prelaunch-plan.html`
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
| `connector/erp/ingest/` (`erp-payload.parsers.ts`, `erp-ingest.service.ts`) | 🟡 มีบางส่วน — parse ได้แค่ product / stock / customer / sale-order |
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

---

## 6. Task list

### Task 1 — ล็อก internal API contract (ทำก่อนเขียนโค้ดบรรทัดแรก)

**ทำอะไร:** ตกลงกับฝั่ง josh ว่า commerce จะเรียกอะไรกลับไป mutate ข้อมูลของ shop

- นิยาม endpoint: upsert product, set stock, update order status, upsert customer
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
- ผ่าน `sync-job` เพื่อให้ retry ได้

**เสร็จเมื่อ:** ยิง payload จริงของ ERP เข้ามาแล้ว `inventory_levels` อัปเดต และ shop อ่านค่าใหม่ได้ · retry ทำงานเมื่อ internal API ล้ม
**เวลา:** 3-4 วัน

---

### Task 3 — Inbound: product / category

**ทำอะไร:**
- `POST /erp/products`, `POST /erp/products/bulk`, `PUT /erp/products/image`
- `POST /erp/categories`, `POST /erp/categories/hierarchy`

`ProductUpsertDto` มี ~40 field (`PRODUCT_NAME_E/T`, `BRAND`, `UNIT`, `UNIT_PER_BOX`, `PACK_SIZE`, `TEMPERATURE`, `NUTRITION_CONTENT`, `ORDERING_OPTIONS`, `COUNTRY_CODE`, …) เป็น upsert ตรง ๆ ไม่มี state machine

**ระวัง:** category hierarchy ต้องจัดการลำดับ parent มาก่อน child ถ้า ERP ส่งไม่เรียง

**เจ้าของข้อมูล:** product master ยังเป็นของ shop — commerce เก็บ mapping + audit แล้วส่งต่อผ่าน internal API

**เวลา:** 4-5 วัน

---

### Task 4 — Inbound: customer / company

- `POST /erp/customers`
- `POST /erp/companies`

ใช้ `integration/mapping` เก็บคู่ external id ↔ shop id

**เวลา:** 2-3 วัน

---

### Task 5 — Outbound: Jagota connector จริง

**ทำอะไร:** แทนที่ mock ปัจจุบัน

- `ErpHttpClient` ต้องชี้ Jagota Node API ไม่ใช่ `/api/v1/*` ที่เป็น stub
- implement `ErpConnector.createOrder()` ให้ยิง `POST /order/add-order-create` จริง แล้วเก็บ `DOC_BOOK` / `DOC_NO` กลับมา
- อีก 5 เส้น: `/quotation/create`, `/customers/create-customer`, `/customers/match-existing`, `/branch/create-branch`, `/finance/get-customer-info`
- ต้นทาง logic: `josh/apps/backend/src/app/jagota-order/jagota-order.service.ts` → `submitCreateOrderToJagota()`

**ระวัง:** auth token ของ Jagota มี cron refresh (`jagota-auth-token.cron.ts`) ย้ายมาด้วยใน Task 6 — ระหว่างนี้อย่าให้รันซ้อนสองฝั่ง

**เวลา:** 4-5 วัน

---

### Task 6 — Cron: auth token + branch status

- `jagota-auth-token.cron.ts`
- `jagota-branch-status.cron.ts`

**สำคัญ:** ปิดฝั่ง `josh/apps/backend` ด้วย env flag **ทันที** ที่ฝั่งนี้ขึ้น ห้ามเปิดทิ้งไว้ทั้งคู่

**เวลา:** 2-3 วัน

---

### Task 7 — Inbound: order / quotation lifecycle (ยากสุด ทำท้ายสุด)

- `POST /erp/orders/status`
- `POST /erp/invoices/status`
- `POST /erp/quotations`
- `POST /erp/quotations/status`

ผูกกับ order lifecycle + sellable stock ของ shop

**ต้อง idempotent จริง** — ERP ยิงซ้ำได้ และ status อาจมาไม่เรียง ต้องกัน status เก่าทับ status ใหม่

**เวลา:** 4-5 วัน

---

### Task 8 — Reliability + wiring

- Dead-letter queue + alert เมื่อ ingest ล้มเกิน N ครั้ง (ห้ามให้ webhook หายเงียบ — นี่คือปัญหาเดิมของ `josh/apps/backend` ที่เป็น ack-only)
- nginx route `/api/erp/*` → commerce-platform
- Smoke test ครบทุก route ด้วย payload จริงจากทีม ERP
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

- [ ] ยืนยันกับทีม ERP ว่า 18 route + payload นิ่งพอจะ implement (หรืออันไหนยังจะเปลี่ยน)
- [ ] เคลียร์ไฟล์ค้าง uncommitted ใน `commerce/order/`, `commerce/reservation/`
- [ ] ตกลงว่า commerce-platform รัน EC2 ตัวไหน และอยู่ VPC เดียวกับ josh backend
- [ ] ตกลงว่า `commerce_db` และ Redis ใช้ instance ร่วมกับ shop หรือแยก (ต้องเข้าถึง Redis ของ shop ได้ถ้าจะ write-through)
- [ ] มี dev bandwidth ต่อเนื่อง ~5-6 สัปดาห์ (migration แบบขาดตอนเสี่ยง drift สูง)

**รวมทั้งหมด ~5-6 สัปดาห์ dev เต็มเวลา**
