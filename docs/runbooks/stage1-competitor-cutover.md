# ขั้น 1 — สลับ competitor / scraping / research มาให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-07-stage1-competitor-ownership.md` · spec §2.4, §4.1

ทำโดย ops (Claude แก้ josh prod ไม่ได้) · ใช้เวลาหยุดเขียนราว 15 นาที · ไม่มี shadow 1 สัปดาห์ (สองระบบจะ
scrape เว็บคู่แข่งซ้ำ) — ใช้ "หยุด josh → คัดลอกครั้งเดียว → เทียบ fingerprint → เปิด commerce" แทน

## ก่อนวันสลับ

1. merge + deploy commerce (migration `1794200000000-CompetitorOwnership` รันตอน deploy)
2. josh: `db-migrate.yml` (migration `1792320000000-CommerceOutboxCatalog`) แล้ว deploy — `COMMERCE_OWNS_COMPETITOR`
   ยังไม่ตั้ง
3. ต้องเปิดช่อง event ขั้น 0 อยู่แล้ว (`JOSH_EVENTS_TO_COMMERCE_ENABLED=true`)
4. ขอ backfill แค็ตตาล็อก (ยังไม่มีปุ่มใน commerce-admin — เรียก API ด้วย staff token):
   `POST https://commerce.joshapp.io/api/reports/order-copy/backfill {"group":"catalog"}`
   → รอจนแถว `catalog` ใน `commerce_outbox` ของ josh ส่งหมด (ทดสอบ local: ~6k สินค้า 15 วินาที)
   → `SELECT count(*) FROM josh_catalog_products WHERE source_version > 0` ต้องเท่าจำนวนสินค้าใน josh

## วันสลับ

5. แจ้งทีม MER / marketing ว่าหยุดแก้ราคาคู่แข่ง / ตั้งค่าเว็บ / research ~15 นาที
6. josh: ตั้ง `COMMERCE_OWNS_COMPETITOR=true` แล้ว restart backend
   - ตรวจ: `POST /api/competitor-prices/match` → 403 · `GET /api/competitor-prices/overview` → 200
   - log ของ josh ไม่มีรอบ scraping / hourly refresh / research cron อีก
7. คัดลอกครั้งเดียว จากเครื่องที่ต่อ DB josh ได้ (ใช้ user อ่านอย่างเดียว):
   ```
   JOSH_DATABASE_URL=<josh read-only> COMMERCE_DATABASE_URL=<commerce prod> npm run import-from-josh -- all
   ```
   เสร็จแล้วอย่าเก็บ `JOSH_DATABASE_URL` ไว้ใน env ของ commerce
8. `COMMERCE_DATABASE_URL=<commerce prod> npm run competitor-parity` → ต้องได้ `mismatched: []`
   (ถ้ามี: catalog ยังตามไม่ทัน → backfill `catalog` อีกรอบ แล้วรันใหม่)
9. commerce env แล้ว restart:
   - `CRON_COMPETITOR_PRICES_REFRESH_ENABLED=true`
   - `RESEARCH_FREE_WORKER_ENABLED=true` (`CRON_MARKETING_RESEARCH_ENABLED=true` อยู่แล้ว)
   - เอา `SCRAPING_CRON_DISABLED` ออก ถ้าตั้งไว้
   - research worker ภายนอก (ถ้ามี) ชี้มา `https://commerce.joshapp.io/api/marketing-research-worker` และใช้
     `RESEARCH_WORKER_TOKEN` ของ commerce
   - (ถ้าจะใช้ AI summary) `RESEARCH_GEMINI_API_KEYS` / `GEMINI_API_KEY`
10. commerce-admin → ตั้งค่าเก็บข้อมูลเว็บ → เปิดสวิตช์ "เก็บข้อมูลอัตโนมัติ"
11. ติ๊กใน checklist (s1-6)

## Rollback

- josh: เอา `COMMERCE_OWNS_COMPETITOR` ออก แล้ว restart → josh เขียนได้และ cron กลับมาทันที
- commerce: ปิด `CRON_COMPETITOR_PRICES_REFRESH_ENABLED`, สวิตช์เก็บข้อมูลอัตโนมัติ และ `RESEARCH_FREE_WORKER_ENABLED`
- ข้อมูลที่แก้ใน commerce ระหว่างนั้น **ไม่** ถูกส่งกลับ josh (ไม่มีทาง commerce → josh สำหรับกลุ่มนี้) — ต้องแก้ซ้ำใน josh
