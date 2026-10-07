# ขั้น 2c — winback อ่านสำเนาใน commerce แทน replica ของ josh

แผน: `docs/superpowers/plans/2026-10-07-stage2c-winback-off-replica.md`

ทำโดย ops · ทำก่อนหรือหลังวันสลับ 2b ก็ได้ (ไม่มี flag — เปลี่ยนตอน deploy commerce) · ต้องเปิดช่อง event ขั้น 0 ไว้แล้ว
(`JOSH_EVENTS_TO_COMMERCE_ENABLED=true`)

## ลำดับ

1. **deploy josh ก่อน** (branch `feat/commerce-copies-for-winback`, migration `1792340000000-CommerceOutboxReference`)
   — trigger ใหม่เริ่มส่ง company / cuisine / restaurant_place / staff ทันที
2. **migrate commerce แต่ยังไม่ deploy โค้ด** (migration `1794500000000-JoshReferenceCopies`) — หรือ deploy ทั้งหมดพร้อมกันได้
   ถ้ายอมให้หน้า winback ว่างระหว่าง backfill (~นาที)
3. backfill (commerce staff token): `POST https://commerce.joshapp.io/api/reports/order-copy/backfill` ทีละ group —
   `{"group":"customer"}` (ได้ `legacy_custcode` / `onboarding_completed`), `{"group":"staff"}`, `{"group":"company"}`,
   `{"group":"cuisine"}`, `{"group":"restaurant_place"}`
4. `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- erp-sales-history` (~554K แถว, เป็นหน้าๆ ละ 5000)
5. เทียบจำนวน — ต้องเท่ากัน (รอ outbox ของ josh หมดก่อน: `SELECT count(*) FROM commerce_outbox WHERE sent_at IS NULL` = 0)

   | josh | commerce |
   |---|---|
   | `SELECT count(*) FROM company` | `SELECT count(*) FROM josh_companies` |
   | `SELECT count(*) FROM cuisine` | `SELECT count(*) FROM josh_cuisines` |
   | `SELECT count(*) FROM restaurant_place` | `SELECT count(*) FROM josh_restaurant_places` |
   | `SELECT count(*) FROM users u LEFT JOIN app_roles r ON r.code = u.role WHERE r.user_type IS DISTINCT FROM 'customer'` | `SELECT count(*) FROM josh_staff` |
   | `SELECT count(*) FROM erp_sales_history` | `SELECT count(*) FROM josh_erp_sales_history` |

6. deploy commerce (branch `feat/stage2c-winback-copies`)
7. ทดสอบ:
   - แอปฝ่ายขาย login (ที่ josh) → เปิด pool / dashboard / lead ได้
   - เปลี่ยนรหัสผ่านพนักงานทดสอบใน josh → token เดิมใช้กับ winback ไม่ได้ภายในไม่กี่วินาที (401) — login ใหม่ใช้ได้
   - ระงับพนักงานทดสอบใน josh → winback ตอบ "บัญชีของคุณถูกระงับ"
   - ฟอร์ม intake: dropdown ประเภทร้านขึ้น
   - หน้า CS มอบหมาย sales (หลังสลับ 2b) → เลือกได้เฉพาะพนักงาน josh
8. ถอด `JOSH_DATABASE_URL` ออกได้ ยกเว้นถ้ายังใช้ `CRON_WINBACK_MIRROR_ENABLED` (mirror ต้องเทียบกับตารางของ josh)
   หรือหน้า/MCP อื่นที่ยังอ่าน replica (รายงานร้านอาหาร `restaurant-places`, price shadow ฯลฯ)

## Rollback

deploy commerce รุ่นก่อนหน้า (อ่าน replica เหมือนเดิม — ต้องมี `JOSH_DATABASE_URL`) · ตารางสำเนาและ trigger ฝั่ง josh
ปล่อยไว้ได้ ไม่กระทบอะไร

## หมายเหตุ

- `erp_sales_history` เป็นไฟล์ export นิ่ง — ถ้ามีไฟล์ใหม่ให้โหลดเข้า josh แล้วรัน import ข้อ 4 ซ้ำ (หรือโหลดเข้า commerce ตรง)
- sign-in ของแอปฝ่ายขายยังเป็น token ของ josh — commerce ตรวจกับ `josh_staff` (token_version / active / role ภายใน)
  แทน replica · ช้ากว่า josh เท่าเวลาส่ง event (ปกติไม่กี่วินาที)
