# ขั้น 6 — สลับบัญชีพนักงานให้ commerce เป็นเจ้าของ

แผน: `docs/superpowers/plans/2026-10-08-stage6-staff-admin.md` · spec §1 (ตารางเจ้าของ: พนักงาน → commerce) ·
การยืนยันตัวตน: `docs/headless-split-plan.md` §6 (ตัดสินแล้ว 2026-10-06)

ทำโดย ops · ที่ย้ายมี 2 ส่วน:

1. **บัญชี commerce-admin ของ MER และ CS** — role ใหม่ `merchandising` (MER) และ `cs` ใน ตั้งค่า › บัญชี staff
   ไม่ต้องสลับ flag — แค่ deploy แล้วสร้าง/เปลี่ยนบัญชี (ตอนนี้ MER/CS ที่ใช้ commerce ต้องเป็น `admin`)
   - MER: ราคาสินค้า + คิว MER, คิวข้อมูลสินค้าจาก ERP, หมวด/แบรนด์, รูปสินค้า, ฟอร์มสินค้า (สร้าง/แก้/อนุมัติ), supplier,
     หน้า josh ที่เป็นสินค้า/หมวด/แบรนด์/supplier/อัปโหลดรูป
   - CS: หน้า josh ที่เป็น order, shipment, งาน CS (`cs-admin/*`, หมวดที่ย้ายของในตะกร้าได้), credit note / credit back
   - ไม่ได้ทั้งคู่: ข้อมูลลูกค้า (PII), KYC, บริษัท/สาขา, admin access, payment testing, รายงานร้าน, AI connector (MCP)
2. **บัญชีพนักงานที่ยังอยู่ใน josh** (แอปฝ่ายขาย, แชต CS, หน้าที่ยังอยู่ josh) — สิทธิ์ / ปิด-เปิด / ออกจากระบบทุกเครื่อง
   ตั้งที่ commerce-admin › ตั้งค่า › บัญชี josh แล้วส่งให้ josh ด้วย `staff.access` · flag `COMMERCE_OWNS_STAFF` ทั้งสองฝั่ง

**ยังอยู่ josh:** สมัครขอเข้าใช้ (`/admin-access/register`) + คิวอนุมัติ (commerce อนุมัติผ่าน relay ได้อยู่แล้ว), รหัสผ่านของ
บัญชี josh (เปลี่ยน/ลืมรหัสเอง), การให้ `platform_admin` · **ไม่ทำในขั้นนี้:** SSO ของบริษัท, ย้าย login แอปฝ่ายขายมา commerce

## ต้องมีก่อน

- ขั้น 2c ใช้งานแล้ว (trigger `staff` ของ josh + backfill `staff` → `josh_staff` ใน commerce)
- **josh `feat/stage6-staff-admin` (pair-ready)** — ฝั่งรับ `staff.access` + flag `COMMERCE_OWNS_STAFF` พร้อมบน webjosh-s6 ·
  ห้ามทำขั้น "วันสลับ" จนกว่า josh branch นั้นจะ deploy แล้ว (ไม่งั้น event ตก dead-letter — ไม่มีอะไรพัง แต่ josh ไม่เปลี่ยน)

## ส่วนที่ 1 — role MER / CS (ไม่มี flag)

1. merge + deploy commerce (migration `1795400000000-JoshStaffAccess` มาด้วย — ตารางว่าง ไม่กระทบอะไร)
2. ตั้งค่า › บัญชี staff → สร้างบัญชี MER 1 คน (role MER) → login → เปิดได้: ราคาสินค้า, คิวข้อมูลสินค้าจาก ERP, `/j/allproducts`,
   `/j/brands` · เปิดไม่ได้ (403): `/j/order`, `/j/allusers`, รายงานร้าน
3. สร้างบัญชี CS 1 คน → เปิดได้: `/j/order`, `/j/shipments`, `/j/cs/delivery-schedule`, `/j/credit-notes` · ไม่ได้: `/j/allproducts`, `/j/allusers`
4. ย้าย MER / CS ที่ตอนนี้เป็น `admin` ลงมาเป็น role ของตัวเอง (ทีละคน — คุยกับหัวหน้าทีมก่อน)

Rollback: เปลี่ยนคนนั้นกลับเป็น `admin` (หรือ revert commit role) — ไม่มีข้อมูลต้องซ่อม

## ส่วนที่ 2 — บัญชี josh

### ก่อน shadow

1. ตรวจสำเนา: josh `SELECT count(*) FROM users u JOIN app_roles r ON r.code = u.role WHERE r.user_type = 'internal'`
   = commerce `SELECT count(*) FROM josh_staff WHERE user_type = 'internal'` (ต่าง → backfill `{"group":"staff"}` ตาม runbook 2c)
2. commerce-admin › ตั้งค่า › บัญชี josh → เห็นรายชื่อครบ อ่านอย่างเดียว ("ยังดูได้อย่างเดียว") · ไม่มีบัญชีระบบ `commerce-platform@…`

### Shadow (~1 สัปดาห์ หรือสั้นกว่า — ข้อมูลน้อย)

3. ทุกวัน: ข้อ 1 ต้องตรง · ไม่มีใครแก้ role ใน josh DB ตรงๆ โดยไม่บอก (josh ไม่มีหน้าแก้ role — แก้ได้ทาง DB/อนุมัติเท่านั้น)

### วันสลับ (หลัง josh `feat/stage6-staff-admin` deploy แล้ว)

4. commerce-admin → Webhooks → subscription ของ josh: **เพิ่ม** `staff.access`
5. josh: `COMMERCE_OWNS_STAFF=true` แล้ว restart — อนุมัติ/ปฏิเสธคำขอในหน้า josh เอง → 403 (ผ่าน commerce ยังได้)
6. commerce: `COMMERCE_OWNS_STAFF=true` แล้ว restart → หน้า บัญชี josh แก้ได้
7. ทดสอบกับบัญชีทดสอบ (ไม่ใช่คนจริง):
   - เปลี่ยน role `sales` → `manager` → ชิป "รอ josh" หายภายในไม่กี่วินาที · josh `users.role` = `manager`
   - กด "ออกจากระบบทุกเครื่อง" → แอปฝ่ายขายที่ login อยู่ได้ 401 ทันที (commerce ตรวจเอง) · josh `token_version` +1
   - ปิดบัญชี → login แอปฝ่ายขายไม่ได้ (`ACCOUNT_SUSPENDED`) · เปิดกลับ → login ใหม่ได้
8. dead-letter ของ webhook ว่าง

## Rollback

- ปิด `COMMERCE_OWNS_STAFF` ทั้งสองฝั่ง → josh จัดการเองตามเดิม · subscription: เอา `staff.access` ออก
- ค่าที่ commerce ตั้งไปแล้วอยู่ใน josh แล้ว (ไม่มีอะไรหาย) · ตาราง `josh_staff_access` ค้างไว้ได้ — ตอน flag ปิด
  ไม่มีใครอ่าน (แอปฝ่ายขายกลับไปเชื่อ `josh_staff` อย่างเดียว) · เปิดกลับ: ค่าบนหน้าคือค่าล่าสุดของ commerce — ถ้า josh
  แก้ระหว่างปิด ให้ตรวจชิป "รอ josh" ก่อนกดอะไร (ค่าไม่ตรง = ขึ้นชิป)

## ข้อจำกัด

- บัญชี commerce กับบัญชี josh เป็นคนละรายการ (ยังไม่ผูกด้วยอีเมล) — พนักงานลาออก: ปิดทั้ง บัญชี staff และ บัญชี josh
- ให้ `platform_admin` จาก commerce ไม่ได้ (ทำใน josh/DB) · บัญชีระบบของ commerce แก้จาก commerce ไม่ได้
- role → หน้าจอของ MER / CS ตั้งจากชื่อหน้า — ถ้าทีมต้องการต่างจากนี้ แก้ `AREAS` ใน `josh-admin-call.controller.ts`
  และ `@StaffRoles` ของ controller
