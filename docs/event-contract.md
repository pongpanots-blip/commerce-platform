# Event contract — commerce hub → platforms

> ใช้กับ **ทุก platform** ที่รับข้อมูลจาก commerce (josh คือตัวแรก) · ที่มา: `docs/erp-integration-tasks.md` §0.1
> เปลี่ยนสัญญานี้ = ต้องแจ้งทุก platform · เพิ่ม field ได้ ห้ามลบ/เปลี่ยนชื่อ

## 1. สมัครรับ event

admin สร้าง webhook subscription (หรือ platform สมัครเองที่ developer portal):

| ค่า | ตัวอย่าง |
|---|---|
| `targetUrl` | `https://josh-backend/api/internal/erp-events` |
| `eventTypes` | `["inventory.qty.changed", "product.price.changed", "product.moq.changed"]` |
| `secret` | ใช้ตรวจ `x-signature` — เก็บเป็นความลับ |

## 2. Request ที่ platform จะได้รับ

`POST <targetUrl>` · `Content-Type: application/json`

| Header | ความหมาย |
|---|---|
| `x-event-type` | ชนิด event เช่น `inventory.qty.changed` |
| `x-delivery-id` | id ของการส่งครั้งนี้ — **ใช้เป็น idempotency key** (retry จะได้ค่าเดิม) |
| `x-signature` | HMAC-SHA256 (hex) ของ raw body ด้วย `secret` |

Body:

```json
{
  "type": "inventory.qty.changed",
  "aggregateId": "<commerce product id (uuid)>",
  "snapshot": true,
  "data": {
    "sku": "1001876",
    "ingestRecordId": "<erp_ingest_records id>",
    "changedAt": "2026-10-03T07:01:29.000Z",
    "erp": { "PRODUCT_CODE": "1001876", "QUANTITY": 48, "CHANGED_AT": "2026-10-03T07:01:29Z", "REASON": "SALE" },
    "...": "field เฉพาะ event ตามตารางข้อ 3"
  }
}
```

- `data.erp` = item ของ ERP **ตามที่ได้รับ** (UPPER_SNAKE) — platform ที่มี handler ของ ERP อยู่แล้ว (josh) ส่งต่อเข้า handler เดิมได้เลย ไม่ต้อง map ใหม่
- `snapshot: true` = ค่าล่าสุดชนะ — event เก่าของ aggregate เดียวกัน**ไม่ถูกส่ง**ถ้ามีตัวใหม่กว่าส่งถึงแล้ว**หรือรอคิวอยู่** (burst ของ SKU เดียวส่งแค่ค่าล่าสุด) · ตัวใหม่กว่าที่ถูกปฏิเสธถาวร (4xx) ไม่นับ ตัวเก่ายังส่ง
- **ลำดับ:** ส่งตามลำดับที่เกิดเสมอ (relay ทีละตัว, คิวส่งเป็น FIFO) — platform ไม่ต้องมีตัวกัน event เก่ามาทับ
- **ความเร็ว:** outbox ปลุกด้วย Postgres `NOTIFY` ตอน commit (ไม่ poll) · วัดบนเครื่อง 2026-10-04: ERP ยิงเข้า commerce → ถึง platform **p50 15 ms / p90 20 ms** (เดิม poll 2 วิ: p50 1,126 ms / p90 1,913 ms) · ถ้า LISTEN หลุด กลับไป poll ทุก 2 วิ และต่อใหม่ใน 5 วิ
- **platform ล่ม:** retry หลัง 1, 2, 4 … วิ (สูงสุดทีละ 60 วิ) นาน ~3 ชม. ก่อนเข้า dead-letter — กลับมาเมื่อไรได้ข้อมูลภายในไม่กี่วินาที (ซ้อมแล้ว: ล่ม 28 วิ → กลับมา 3.3 วิ ได้ครบ) · ERP ยังได้ `200` ตลอดเวลาที่ platform ล่ม
- **แจ้งเตือน:** `ALERT_WEBHOOK_URL` (Slack / Google Chat / Teams) เมื่อคิวรอเกิน 60 วิ, มี dead-letter, หรือ relay ค้าง · ซ้ำทุก 30 นาทีถ้ายังไม่หาย · แจ้ง ✅ เมื่อหาย · `GET /api/health/delivery` ตอบ 503 ระหว่างมีปัญหา (ให้ uptime monitor ยิง)

## 3. Event catalog

| `type` | มาจาก | field เพิ่มใน `data` |
|---|---|---|
| `inventory.qty.changed` | `PUT /erp/products/qty` **หรือ** การปรับสต็อกในคลังที่ commerce เป็นเจ้าของ | `source` (`erp` / `commerce`), `quantity` (int ≥ 0), `previousQuantity`, `warehouseCode`, `reason`, `ingestRecordId` (erp) หรือ `movementId` (commerce) |
| `product.price.changed` | `PUT /erp/products/price` | `orderingPrice`, `sellingUnitPrice` (string 2 ตำแหน่ง หรือ null = ไม่เปลี่ยน) |
| `product.moq.changed` | `PUT /erp/products/moq` | `moq` |

qty ที่ **เก่ากว่า** ค่าที่ commerce มีอยู่ (ดูจาก `CHANGED_AT`) จะไม่ถูกส่งออก ระบบเก็บไว้เป็น movement `stale` ใน ledger อย่างเดียว

### สต็อกจากคลังที่ commerce เป็นเจ้าของ (`source: "commerce"`)

คลังที่ `stock_source = 'commerce'` (ระบบคลังของเราเอง §0.2) ส่ง `inventory.qty.changed` **ชนิดเดียวกันและหน้าตาเดียวกัน**กับสต็อกจาก ERP:

- **ก้อน `data.erp`:** ยังมีเสมอและเป็นรูปแบบเดียวกับ ERP คือ `PRODUCT_CODE`, `QUANTITY`, `CHANGED_AT`, `REASON`
  - เหตุผลแปลงเป็นคำของ ERP: RECEIVE/RETURN → `RECEIVE` ส่วนเหตุผลอื่นเป็น `ADJUST`
  - เหตุผลจริงอยู่ใน `data.reason` (COUNT / RECEIVE / DAMAGE / RETURN / CORRECTION)
  - ผลคือ platform ที่ส่ง `data.erp` เข้า handler ของ ERP อยู่แล้ว (josh) **ไม่ต้องแก้โค้ด** ตอนย้ายคลังจาก ERP มาเป็นของ commerce
- **ส่งเฉพาะเมื่อยอดเปลี่ยนจริง:** event ออกเมื่อ movement เป็น `applied` และเขียนลง outbox ใน transaction เดียวกับ ledger
- **ไม่ชนกับ ERP:** คลังแต่ละแห่งรับยอดได้จากเจ้าของเท่านั้น คลังของ commerce จึงไม่มี event จาก ERP มาทับ และคลังของ ERP ก็ปรับจาก commerce ไม่ได้
- **ทดสอบแล้ว (2026-10-03):** ใช้ build จริงของ josh (`feat/commerce-hub-integration`) โดยไม่แก้โค้ด josh
  - AI ปรับสต็อกผ่าน MCP: josh เปลี่ยนเป็น 9 แล้วรับเข้า +3 เป็น 12
  - คลัง ERP ถูกปฏิเสธและไม่มี event ออก
  - qty จาก ERP feed ยังเข้า josh ได้ และติดป้าย `source: "erp"`

## 4. ผู้รับต้องทำ

1. ตรวจ `x-signature` กับ raw body — ไม่ตรง → ตอบ `401`
2. กันซ้ำด้วย `x-delivery-id` (เช่น Redis `SET NX` TTL 24 ชม.) — ซ้ำ → ตอบ `2xx` เหมือนครั้งแรก
3. ตอบตามผล:

| ตอบ | commerce ทำอะไร |
|---|---|
| `2xx` | สำเร็จ |
| `4xx` (ยกเว้น 408, 429) | ข้อมูลใช้ไม่ได้ (payload ผิด / SKU ไม่มี) — **ไม่ retry** · ขึ้นใน dead-letter ให้คนดู |
| `5xx`, `408`, `429`, timeout (10 วินาที), ต่อไม่ติด | retry สูงสุด 200 ครั้ง backoff 1s·2^n สูงสุดทีละ 60 วิ (≈3 ชม.) · เกินนั้นเข้า dead-letter |

4. ทำงานเร็ว — ถ้าต้องทำงานหนัก ให้รับไว้แล้วตอบ `2xx` ก่อน (commerce รอไม่เกิน 10 วินาที)

## 5. josh (platform แรก)

`POST /api/internal/erp-events` → ตรวจ signature + กันซ้ำ → ตาม `x-event-type` เรียก handler เดิม:

| event | handler เดิมใน `erp-webhook.service.ts` |
|---|---|
| `inventory.qty.changed` | `handleQtyChange([data.erp])` |
| `product.price.changed` | `handlePriceChange([data.erp])` — ราคาเข้า staging รอ MER ตามเดิม |
| `product.moq.changed` | `handleMoqChange([data.erp])` |

`failed` ที่ handler คืน (SKU ไม่มีใน shop) → ตอบ `422` · error อื่น → `5xx`

qty ที่มี `CHANGED_AT` ผ่านตัวกันข้อมูลเก่า (`commerce_applied_versions`) — ทั้งที่มาจาก commerce และที่ ERP ยิงตรง
เข้า josh: ตัวที่เก่ากว่าค่าที่ใช้ไปแล้วถูกข้ามและนับเป็น `stale` ในคำตอบ

## 6. ทาง josh → commerce

josh ส่ง event จาก `commerce_outbox` (trigger บน `orders` / `order_items` / `payment_transactions` /
`payment_transaction_orders` / `users` ที่เป็นลูกค้า) — เปิดด้วย `JOSH_EVENTS_TO_COMMERCE_ENABLED=true` ฝั่ง josh
(ค่าเริ่มต้นปิด: trigger ยังบันทึก แต่ไม่ส่ง)

- `POST {COMMERCE_PLATFORM_BASE_URL}/internal/josh-events` · header `x-event-type`, `x-delivery-id`
  (`<type>:<aggregateId>:<version>`), `x-signature` = HMAC-SHA256 hex ของ body ด้วย `COMMERCE_EVENTS_SECRET`
  (josh) — ค่าเดียวกับ `JOSH_EVENTS_SECRET` (commerce)
- body `{ type, aggregateId, version, occurredAt, data }` · `version` = `commerce_snapshot_seq` ของ josh (ตัวเลข string)
- commerce รับเฉพาะ version ที่ใหม่กว่าที่เก็บไว้ ตัวเก่า/ซ้ำตอบ `200` แล้วทิ้ง
- josh ส่งซ้ำเมื่อไม่ได้ `2xx` (backoff 1s·2^n สูงสุด 60 วิ ไม่ทิ้ง) · แถวเก่ากว่า 7 วันถูก prune → ซ่อมด้วย backfill

| type | data |
|---|---|
| `order.snapshot` | `{ order, items }` — คอลัมน์เดียวกับ `josh_orders` / `josh_order_lines` |
| `customer.snapshot` | คอลัมน์ลูกค้าที่ไม่อ่อนไหว (ไม่มีรหัสผ่าน / `token_version`) + `branch_ids` |
| `customer.deleted` | `{ id }` — commerce ล้างข้อมูล เก็บ tombstone กัน snapshot เก่ามาสร้างกลับ |
| `erp.fallback.received` | `{ method, path, body, receivedAt }` — ERP ยิงตรงเข้า josh `/api/erp/*` |

Backfill: commerce staff `POST /api/reports/order-copy/backfill {"group":"order"|"customer"}` → josh
`POST /internal/commerce/backfill` (ลงลายเซ็นแบบ commerce → josh)
