# ขั้น 2a — สลับ customer metrics และ segment มาให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-07-stage2a-customer-marketing.md` · spec §2.4, §4.1

ทำโดย ops (Claude แก้ josh prod ไม่ได้) · ต้องเปิดช่อง event ขั้น 0 ไว้แล้ว (`JOSH_EVENTS_TO_COMMERCE_ENABLED=true`
และ backfill `order` เสร็จ — metrics คำนวณจากสำเนา order)

## ก่อน shadow

1. merge + deploy commerce (migration `1794300000000-CustomerMarketing`) และ josh (migration
   `1792330000000-CommerceOutboxCustomerExtras`) — flag ทุกตัวยังปิด
2. backfill ลูกค้าใหม่ให้ได้ tier / cuisine:
   `POST https://commerce.joshapp.io/api/reports/order-copy/backfill {"group":"customer"}` (staff token)

## Shadow ~1 สัปดาห์

3. **metrics:** commerce `CRON_JOSH_CUSTOMER_METRICS_ENABLED=true`, `CUSTOMER_METRICS_TO_JOSH=shadow`
   - ทุกคืน 02:30 log ของ commerce มี `customer metrics → josh (shadow): {"sent":…,"different":…}`
   - josh ยังคำนวณเองตามเดิม (ไม่เขียนอะไรจาก commerce)
   - `different` ต้องเป็น 0 ตั้งแต่คืนที่ 2 (คืนแรกอาจต่างจาก order ที่ backfill ยังไม่ครบ) — ถ้าไม่ 0 ดู `sample`
4. **segment:** `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- segments` (ครั้งเดียว แล้วเอา URL ออก)
   แล้วรัน `npm run segment-parity` ทุกวัน → `different: []`
   - `liveInJosh` = segment แบบ live (guest / member / staff / role / custype / has_company) josh คำนวณเองทุก request
     ไม่ได้เทียบ

## วันสลับ

5. แจ้งทีม marketing ว่าหยุดสร้าง / แก้ segment ~15 นาที
6. josh: `COMMERCE_OWNS_CUSTOMERS=true` แล้ว restart
   - segment create / edit / delete → 403 · การมอบหมาย sales → 403 (ย้ายในขั้น 2b)
   - แก้ข้อมูลลูกค้า / สาขา / ใบขอเครดิต / บริษัทใน CS-admin **ยังทำได้** (ข้อมูลที่ใช้ตอนซื้อ อยู่ josh)
   - josh เลิก freeze segment เอง
7. import segment อีกรอบ (ได้ตัวที่สร้างระหว่าง shadow): `npm run import-from-josh -- segments`
8. commerce-admin → Webhooks → subscription ของ josh → เพิ่ม event types `segment.upserted`, `segment.members`,
   `segment.deleted`
9. commerce env แล้ว restart: `COMMERCE_OWNS_SEGMENTS=true`, `CUSTOMER_METRICS_TO_JOSH=on`
10. ทดสอบ: สร้าง segment ทดสอบใน commerce-admin (หน้า segment ของ josh เดิม — ปุ่มบันทึกส่งไป commerce เองตาม
    `GET /api/ownership`) → ใน josh admin เห็น segment id เดียวกัน `member_count` เท่ากัน แล้วลบทิ้ง
11. ติ๊ก checklist s2-1 … s2-5

## Rollback

- josh: เอา `COMMERCE_OWNS_CUSTOMERS` ออก แล้ว restart → แก้ segment / sales ใน josh ได้ และ josh freeze เองตามเดิม
- commerce: `COMMERCE_OWNS_SEGMENTS=false`, `CUSTOMER_METRICS_TO_JOSH=off` แล้ว restart; เอา segment.* ออกจาก subscription
- segment ที่สร้างใน commerce ระหว่างนั้นอยู่ใน josh แล้ว (id เดียวกัน) — ไม่มีอะไรหาย

## PDPA

ลูกค้าถูกลบใน josh → `customer.deleted` → commerce ล้างสำเนา, ลบ metrics และการเป็นสมาชิก segment ของคนนั้น ·
ฝั่ง josh แถว snapshot ถูกลบตาม user (FK cascade) · `member_count` ไม่เปลี่ยนทั้งสองฝั่ง (เป็นจำนวน ณ ตอน freeze)
