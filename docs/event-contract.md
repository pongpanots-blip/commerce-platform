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
- `snapshot: true` = ค่าล่าสุดชนะ — ถ้ามี event ใหม่กว่าของ product เดียวกันส่งถึงแล้ว event เก่าที่ยังค้าง retry จะ **ไม่ถูกส่ง**

## 3. Event catalog

| `type` | มาจาก ERP route | field เพิ่มใน `data` |
|---|---|---|
| `inventory.qty.changed` | `PUT /erp/products/qty` | `quantity` (int ≥ 0), `previousQuantity`, `warehouseCode`, `reason` (SALE/RECEIVE/ADJUST หรือ null) |
| `product.price.changed` | `PUT /erp/products/price` | `orderingPrice`, `sellingUnitPrice` (string 2 ตำแหน่ง หรือ null = ไม่เปลี่ยน) |
| `product.moq.changed` | `PUT /erp/products/moq` | `moq` |

qty ที่ **เก่ากว่า** ค่าที่ commerce มีอยู่ (ดูจาก `CHANGED_AT`) จะไม่ถูกส่งออก — เก็บเป็น movement `stale` ใน ledger อย่างเดียว

## 4. ผู้รับต้องทำ

1. ตรวจ `x-signature` กับ raw body — ไม่ตรง → ตอบ `401`
2. กันซ้ำด้วย `x-delivery-id` (เช่น Redis `SET NX` TTL 24 ชม.) — ซ้ำ → ตอบ `2xx` เหมือนครั้งแรก
3. ตอบตามผล:

| ตอบ | commerce ทำอะไร |
|---|---|
| `2xx` | สำเร็จ |
| `4xx` (ยกเว้น 408, 429) | ข้อมูลใช้ไม่ได้ (payload ผิด / SKU ไม่มี) — **ไม่ retry** · ขึ้นใน dead-letter ให้คนดู |
| `5xx`, `408`, `429`, timeout (10 วินาที), ต่อไม่ติด | retry 5 ครั้ง backoff 30s → 60s → 2m → 4m · เกินนั้นเข้า dead-letter |

4. ทำงานเร็ว — ถ้าต้องทำงานหนัก ให้รับไว้แล้วตอบ `2xx` ก่อน (commerce รอไม่เกิน 10 วินาที)

## 5. josh (platform แรก)

`POST /api/internal/erp-events` → ตรวจ signature + กันซ้ำ → ตาม `x-event-type` เรียก handler เดิม:

| event | handler เดิมใน `erp-webhook.service.ts` |
|---|---|
| `inventory.qty.changed` | `handleQtyChange([data.erp])` |
| `product.price.changed` | `handlePriceChange([data.erp])` — ราคาเข้า staging รอ MER ตามเดิม |
| `product.moq.changed` | `handleMoqChange([data.erp])` |

`failed` ที่ handler คืน (SKU ไม่มีใน shop) → ตอบ `422` · error อื่น → `5xx`
