# ขั้น 2b — สลับ winback และการมอบหมาย sales ให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-07-stage2b-winback-sales-reps.md` · spec §1, §4.1

ทำโดย ops (Claude แก้ josh prod ไม่ได้) · **ต้องสลับขั้น 2a ก่อน** (josh `COMMERCE_OWNS_CUSTOMERS=true` แล้ว —
ใช้ flag ตัวเดียวกันล็อกการมอบหมาย sales ใน josh) · commerce ต้องมี `JOSH_DATABASE_URL` (replica, read-only) เพราะ
winback ยังอ่านข้อมูล josh และตรวจ login ผ่าน replica (ตัดในขั้น 2c)

## ก่อน shadow

1. merge + deploy josh (branch `feat/commerce-owns-winback`) และ commerce (migration `1794400000000-CompanySalesReps`)
   — flag ทุกตัวยังปิด
2. `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- sales-reps`

## Shadow ~1 สัปดาห์

3. commerce `CRON_WINBACK_MIRROR_ENABLED=true` แล้ว restart — ทุก 5 นาที commerce คัดลอกตาราง winback จาก josh
   (josh ยังเป็นเจ้าของ)
4. ทุกวันเทียบจำนวนแถวสองฝั่ง — ต้องเท่ากัน (ต่างกันได้ชั่วคราวไม่เกินรอบ mirror):

   ```sql
   SELECT 'winback_account', count(*) FROM winback_account UNION ALL
   SELECT 'winback_contact', count(*) FROM winback_contact UNION ALL
   SELECT 'winback_activity', count(*) FROM winback_activity UNION ALL
   SELECT 'winback_stage_history', count(*) FROM winback_stage_history UNION ALL
   SELECT 'winback_sales_target', count(*) FROM winback_sales_target UNION ALL
   SELECT 'winback_meeting_ack', count(*) FROM winback_meeting_ack;
   ```

5. sales ของบริษัท: รัน import อีกรอบแล้วเทียบ — ต้องเท่ากัน
   - josh: `SELECT count(*) FROM company WHERE assigned_sales_user_id IS NOT NULL`
   - commerce: `SELECT count(*) FROM company_sales_reps WHERE assigned_sales_user_id IS NOT NULL`

## วันสลับ

6. แจ้งทีมขาย / CS ว่าหยุดใช้แอป saleactivity และปุ่มมอบหมาย sales ~15 นาที
7. รอ mirror รอบถัดไปให้จบ (log `WinbackMirror`) แล้วเทียบจำนวนแถวตามข้อ 4 อีกครั้ง
8. commerce-admin → Webhooks → subscription ของ josh → เพิ่ม event types `winback.notify`, `winback.welcome_email`,
   `winback.row`, `company.sales_rep`
9. josh: `WINBACK_OWNED_BY_COMMERCE=true` แล้ว restart
   - การเขียน winback ใน josh → 409 · cron แจ้งเตือน winback ของ josh หยุด · login ของลูกค้าส่ง promote ไป commerce
10. commerce env แล้ว restart: `WINBACK_OWNER=commerce`, `COMMERCE_OWNS_SALES_REPS=true`,
    `CRON_WINBACK_APPOINTMENTS_DUE_ENABLED=true`, `CRON_WINBACK_DAILY_DIGEST_ENABLED=true`,
    `CRON_WINBACK_AGING_LEADS_ENABLED=true` (`CRON_WINBACK_MIRROR_ENABLED` เปิดค้างไว้ — ตอนนี้ส่งกลับ josh เป็น `winback.row`)
11. `npm run import-from-josh -- sales-reps` อีกรอบ (ได้ที่แก้ระหว่าง shadow)
12. nginx: `/api/winback/*` → commerce แล้ว reload
13. ทดสอบ:
    - แอปขาย login (ยังที่ josh) → สร้าง lead ทดสอบ → แถวขึ้นใน josh `winback_account` ภายใน 5 นาที แล้วลบทิ้ง
    - หน้า CS (commerce-admin) มอบหมาย sales ให้บริษัททดสอบ → josh `company.assigned_sales_user_id` เปลี่ยนตาม
    - ลูกค้าที่มี TMP lead login → lifecycle ใน commerce เป็น `lead`
    - เซลล์ได้แจ้งเตือน lead_assigned (ส่งโดย josh จาก `winback.notify`)

## Rollback

- nginx `/api/winback/*` กลับไป josh
- josh: เอา `WINBACK_OWNED_BY_COMMERCE` ออก แล้ว restart
- commerce: `WINBACK_OWNER=josh`, `COMMERCE_OWNS_SALES_REPS=false`, cron แจ้งเตือน 3 ตัวปิด แล้ว restart (mirror กลับเป็น
  josh → commerce เอง)
- ข้อมูลที่เขียนใน commerce ระหว่างนั้นอยู่ใน josh แล้ว (`winback.row`, `company.sales_rep`) — ไม่มีอะไรหาย

## PDPA

ลูกค้าถูกลบใน josh → `customer.deleted` → commerce ตัด `josh_user_id` ของ
winback account ที่ผูกกับคนนั้น · หลังสลับ การตัดลิงก์ winback ไปถึง josh ทาง mirror (`winback.row`)

## ข้อจำกัด

- winback ยังอ่าน users / orders / company / ร้าน / ยอดขาย ERP / cuisine และตรวจ login ผ่าน replica ของ josh —
  josh DB ล่ม = แอปขายใช้ไม่ได้ (หน้าร้านไม่กระทบ) · ตัดในขั้น 2c
- commerce ล่ม = แอปขายและปุ่มมอบหมาย sales ใช้ไม่ได้ (หน้าร้านไม่กระทบ)
