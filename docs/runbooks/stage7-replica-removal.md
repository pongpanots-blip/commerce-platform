# ขั้น 7 — ถอด replica ของ josh (`JOSH_DATABASE_URL`) และเครื่องมือช่วงย้าย

แผน: `docs/superpowers/plans/2026-10-09-stage7-cleanup.md` · spec §1 (ไม่มี read replica ไม่มีสะพานอ่าน DB ของ josh)

ทำโดย ops + dev ทีละชั้น · **ห้ามข้ามประตู (gate)** — ถ้าไม่แน่ใจว่าผ่านแล้ว ถือว่ายังไม่ผ่าน · ทุกข้อก่อนข้อ 6
rollback ได้ด้วยการตั้ง env กลับ (โค้ดยังอยู่) · ข้อ 6–7 ลบโค้ด/สิทธิ์จริง rollback = deploy รุ่นก่อนหน้า + สร้าง user ใหม่

## 0. ก่อนเริ่ม (ต้องครบทุกข้อ)

- master มี S4f (G5), S4g (G9), S5, S6 แล้ว — ก่อนหน้านั้นรายงานทุกหน้าอ่าน replica อย่างเดียว ถอดแล้วจะว่าง
- รัน inventory บน master แล้วตรงกับแผน §1:
  ```bash
  grep -rln "JoshReplica\|josh-replica'\|process.env.JOSH_DATABASE_URL" apps/commerce-platform/src --include=*.ts | grep -v '\.spec\.'
  npx jest -c apps/commerce-platform/jest.config.cts --runInBand apps/commerce-platform/src/replica-readers.spec.ts
  ```
- **เช็กก่อน: prod ตั้ง `JOSH_DATABASE_URL` อยู่หรือไม่** (แผน §3 q1 — เอกสารขั้น 1 บอกว่าไม่มี แต่ขั้น 5 คาดว่ามี)
  `docker compose exec commerce-platform printenv JOSH_DATABASE_URL | sed 's/:[^:@]*@/:***@/'`
  - ไม่มี → หน้าที่อ่าน replica บน prod ขึ้น "not configured" / `joshOnly` อยู่แล้ว ข้อ 2–3 คือการตรวจว่าไม่มีใครใช้ ไม่ใช่การปิด
  - มี → ทำตามลำดับด้านล่าง

## 1. ประตูของแต่ละกลุ่ม (ops ยืนยันเป็นลายลักษณ์อักษร แล้วติ๊กในแผน)

| กลุ่ม | ผ่านเมื่อ | อ้างอิง |
|---|---|---|
| 4a ราคา | `COMMERCE_OWNS_PRICES` เปิดบน josh ≥ 1 สัปดาห์, `price-parity` หลังสลับ = 0 ทุกวัน | `stage4a-prices-cutover.md` |
| 4b–4e เนื้อหา / หมวด / master / รูป | flag เปิด ≥ 1 สัปดาห์, parity ของกลุ่มนั้น = 0 | runbook 4b–4e |
| 4f ordering (G5) | หลัง josh follow-up Task 1 + flag เปิด ≥ 1 สัปดาห์, `ordering-parity` = 0 | G5 STATUS |
| 4g promotions (G9) | flag เปิด ≥ 1 สัปดาห์ | `stage4g-promotions-cutover.md` |
| winback | `WINBACK_OWNER=commerce` บน prod ≥ 1 สัปดาห์ | runbook 2b/2c |
| ERP gateway | ส่ง order → Jagota ผ่าน commerce แล้ว (jagota-shadow ไม่จำเป็น) | – |
| รายงาน (S5) | switch 1–9 เป็น `copies` ≥ 1 สัปดาห์ | `stage5-reports-copies.md` |
| staff (S6) | **ไม่เกี่ยว** — ขั้น 7 ไม่ลบอะไรของ staff | S6 STATUS |

## 2. ปิด cron ที่อ่าน replica (env เท่านั้น — rollback = เปิดกลับ)

ทีละตัว หลังประตูของมันผ่าน · restart commerce · ดู log ว่าไม่มี error ใหม่ 1 วัน

| env | ประตู | หมายเหตุ |
|---|---|---|
| `CRON_JOSH_CATALOG_SYNC_ENABLED=false` | backfill `catalog` + event เชื่อถือได้ (`competitor-parity` = 0) | **ค่าเริ่มต้นเปิด** — ต้องตั้ง `false` เอง |
| `CRON_JOSH_ORDER_COPY_ENABLED=false` | `order.snapshot` เชื่อถือได้ (S5 #3–6 ผ่าน) | |
| `CRON_JAGOTA_SYNC_IMPORT_ENABLED=false` | backfill `jagota_sync` ตรวจแล้ว (S5-11 ข้อ 4) | |
| `CRON_STAFF_PRICES_IMPORT_ENABLED=false` | 4a | |
| `CRON_PRICE_SHADOW_ENABLED=false` | 4a | |
| `CRON_JAGOTA_SHADOW_ENABLED=false` | ERP gateway | |
| `CRON_WINBACK_MIRROR_ENABLED=false` | winback | |
| `CRON_JOSH_BESTSELLERS_ENABLED` คงเปิดได้ | `BESTSELLERS_SOURCE=copies` | job ยังใช้ต่อ แค่ไม่อ่าน replica |

## 3. ซ้อมถอด (env เท่านั้น — rollback = ใส่ค่ากลับ)

1. staging: ลบ `JOSH_DATABASE_URL` ออกจาก env → deploy → เปิดทุกหน้าใน commerce-admin + เรียก MCP tool ทุกตัว
   (checklist S5-16) · หน้าที่เหลือต้องขึ้นข้อความ `joshOnly` (อธิบายว่าอยู่ josh-admin) ไม่ใช่ 503 เปล่า
2. prod: ลบ GitHub secret `JOSH_DATABASE_URL` → deploy (ตัวเขียน `.env` ข้ามค่าว่างอยู่แล้ว ค่าจะหายเอง)
3. เฝ้า 1 สัปดาห์: ไม่มีหน้าไหน "not configured", MCP ตอบครบ, ไม่มี error `commerce-josh-replica` ใน log
4. **CLI ช่วงย้ายยังใช้ได้** ระหว่างนี้: ใส่ URL เฉพาะตอนรัน `JOSH_DATABASE_URL=<read-only> npm run <x>-parity`
   — ไม่ต้องเก็บไว้ใน env ของแอป
5. rollback: ใส่ secret กลับแล้ว deploy

## 4. ลบโค้ดชั้น B (copier / shadow) — dev, หลังข้อ 2 ของตัวนั้นผ่าน 1 สัปดาห์

ตามแผน S7-4 · ทีละ PR · ลบไฟล์ + cron ใน `config/cron.config.ts` + `CRON_*` ใน `.env.example` + route + ปุ่มใน
commerce-admin + แถวใน `replica-readers.spec.ts`

## 5. ลบโค้ดชั้น A (ทาง replica ของรายงาน) — dev, หลังข้อ 3 ผ่าน

ตามแผน S7-5 · เก็บทาง `copies` · ลบทาง `replica` / `shadow` และ route `/parity` · switch อ่านแล้วไม่สนใจ 1 รุ่น
แล้วค่อยลบ env · แถวที่รอเจ้าของตัดสิน (traffic, order target group, ลูกค้า KYC, back-office, ราคาตามสาขา,
mechanics โปรโมชัน) — ไม่แตะจนกว่าจะมีคำตอบ

## 6. ลบ CLI ชั้น C — dev, หลังกลุ่มสุดท้ายสลับ + พ้นช่วง rollback

- ห้ามลบก่อน: import คือทาง rollback ที่เขียนไว้ใน `prod-data-from-josh.md` ("ยกเว้นตอน rollback") และ parity
  ใช้ดูหลังสลับว่า josh รับ snapshot ครบ
- ช่วง rollback หลังกลุ่มสุดท้าย: ยังไม่ได้ตัดสิน (แผน §3 q3 — เสนอ 2 สัปดาห์)
- ลบ `import-from-josh.ts`, `*-parity.ts` ที่ใช้ replica, script ใน `package.json` · แก้ `prod-data-from-josh.md`:
  ซ่อมข้อมูลด้วย backfill (event) เท่านั้น
- `competitor-parity`, `segment-parity` ไม่ใช้ replica — ไม่ต้องลบในขั้นนี้

## 7. ลบ `JoshReplica` + สิทธิ์ — dev + ops, สุดท้าย

1. dev: เมื่อ `replica-readers.spec.ts` เหลือแค่ `josh-replica.ts` + `josh.module.ts` → ลบ `JoshReplica`,
   `JOSH_PRICING_TABLES`, provider, ข้อความ `NO_REPLICA` · ลบ `JOSH_DATABASE_URL` จาก `deploy-ecr.yml`,
   `docker-compose.prod.yml`, `.env.example` · `scripts/josh-postgres-readonly-user.mjs` ลบได้ ·
   `scripts/josh-db-readonly-users.sh` **ลบเฉพาะส่วน Postgres** (ส่วน Mongo ยังใช้กับ `JOSH_MONGO_URL`)
2. ops บนเครื่อง josh-db: `REVOKE ALL ... FROM commerce_ro; DROP ROLE commerce_ro;` (Postgres) · ปิด 5432 จาก
   commerce ใน Security Group (27017 ยังเปิดไว้ให้ Mongo)
3. ตรวจ: `grep -rn "JOSH_DATABASE_URL\|JoshReplica" apps libs scripts docker .github` → เหลือเฉพาะเอกสารประวัติ

## ไม่ใช่ขั้น 7 (อย่าลบ)

ตัวรับ `josh-events` + ตาราง `josh_*` · `POST /reports/order-copy/backfill` (สั่ง josh ทาง API) · relay / `JoshActions`
(`JOSH_API_URL`, `JOSH_EVENTS_SECRET`) · Mongo log ของ josh (`JOSH_MONGO_URL`) · ทุกอย่างของ staff (S6: `admin-access`
relay, `josh_staff`, `josh_staff_access`)
