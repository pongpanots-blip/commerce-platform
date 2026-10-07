# ข้อมูลตั้งต้นบน prod — ดึงจาก josh prod ทั้งหมด

ข้อมูลทุกกลุ่มที่ commerce เป็นเจ้าของต้องเริ่มจาก **josh prod** (ไม่ใช่ DB ของ dev / staging) แล้วเทียบให้ตรงก่อนสลับ
ทำโดย ops — Claude เข้า josh prod ไม่ได้

## ช่องทาง

1. **import (อ่าน DB ของ josh ตรง)** — `npm run import-from-josh -- <scope>` บนเครื่อง/คอนเทนเนอร์ของ commerce prod
   - `JOSH_DATABASE_URL` = **josh prod แบบอ่านอย่างเดียว** (read replica หรือ user ที่มีแค่ SELECT) — ห้ามใช้ user ที่เขียนได้
   - `COMMERCE_DB_*` / `COMMERCE_DATABASE_URL` = commerce prod
   - อ่านเป็นชุด (1,000–5,000 แถว) ไม่ล็อกตารางของ josh · รันซ้ำได้ (upsert / แทนทั้งชุด)
2. **backfill (josh ส่งผ่าน event)** — `POST https://commerce.joshapp.io/api/reports/order-copy/backfill {"group":"<group>"}`
   (staff token) → josh ใส่ snapshot ทุกแถวของกลุ่มลง outbox แล้วส่งมาเองทีละชุด · ต้องเปิด `JOSH_EVENTS_TO_COMMERCE_ENABLED`
   ที่ josh และตั้ง `JOSH_EVENTS_SECRET` ให้ตรงกันก่อน

## ลำดับ (ตามขั้น)

| ขั้น | ทาง | คำสั่ง / group | เช็ก |
|---|---|---|---|
| 0–1 | backfill | `order`, `customer`, `catalog` | หน้า order-copy / `competitor-parity` |
| 1 | import | `research`, `scraping`, `competitor` (หลัง scraping) | `npm run competitor-parity` |
| 2a | import | `segments` | `npm run segment-parity` |
| 2b | import | `sales-reps` (รันซ้ำวันสลับ) | runbook 2b |
| 2c | backfill + import | `company`, `cuisine`, `restaurant_place`, `staff` · import `erp-sales-history` | runbook 2c |
| 3 | — | stock มาจาก ERP / ledger ของ commerce (ไม่ import) | runbook 3 (`sellable-snapshots/resend`) |
| 4a | import | `prices` | `npm run price-parity` |
| 4b | import | `contents` | `npm run content-parity` |
| 4c | import | `categories` | `npm run category-parity` |
| 4d | import | `masters` (หลัง `categories`) | `npm run master-parity` |
| 4e | import | `images` | `npm run image-parity` |
| 6 | backfill (มีแล้วจาก 2c) | `staff` — `josh_staff_access` เริ่มว่าง (ไม่ import) | runbook 6 (นับ `josh_staff` เทียบ josh) |

`npm run import-from-josh -- all` รันทุก import ตามลำดับในตาราง (ไม่รวม backfill)

## กติกา

- import ก่อน shadow, ทุกวันระหว่าง shadow, และ**รอบสุดท้ายในวันสลับ**หลังหยุดแก้ที่ josh — แล้ว parity ต้องเป็น 0 ก่อนเปิด flag
- หลังเปิด flag ของกลุ่มไหนแล้ว **ห้าม import กลุ่มนั้นซ้ำ** (จะทับค่าที่แก้ใน commerce ด้วยสำเนาของ josh) — ยกเว้นตอน rollback แล้วจะเปิดกลับ
- parity หลังสลับใช้ดูว่า josh รับ snapshot ครบ — ถ้าต่าง ดู dead-letter ของ webhook ก่อน
