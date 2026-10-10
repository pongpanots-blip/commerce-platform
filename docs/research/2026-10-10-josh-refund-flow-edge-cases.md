# Josh Refund Flow — ทางเลือกคืนเงิน + Edge Cases

> ขอบเขต: josh (`apps/backend`, mobile, shop-web, web-admin) — order/payment อยู่ josh ถาวร, commerce รับแค่ event ไปทำรายงาน
> อ้างอิงโค้ด: josh `origin/main` ณ 2026-10-10 · Figma: "Refund Detail", "Choose Refund Method", "Choose Refund Method – Weight Diff"

## 1. Flow หลัก

**ทำ refund flow ใหม่ทั้งหมด** — ไม่ต่อยอด flow `cs-crm-claims` / `cs-admin` refund เดิม (ไม่อ่าน ไม่แก้ ไม่ map สถานะเดิม)

ใช้ของเดิมแค่ชิ้นที่เป็น "เครื่องมือ":
- `CreditBackService` — ออก/ยกเลิก CreditBack
- `KbankApiClient` — เพิ่ม `voidCharge` / `refundCharge` / ใช้ `inquiryTransaction`
- `payment_transactions` + `payment_transaction_orders` — หา charge และยอดที่จ่ายต่อออเดอร์

ที่มา refund (ป้อนเข้า flow ใหม่):

| ที่มา | หมายเหตุ |
|---|---|
| ส่วนต่างน้ำหนัก (invoice < order) | ตอนนี้ออก CreditBack `invoice_delta` อัตโนมัติ → เปลี่ยนให้สร้าง refund รอลูกค้าเลือกวิธี (หลัง flag) |
| คืนสินค้า / ของเสีย | ทำใหม่ใน flow นี้ |
| ยกเลิกออเดอร์ที่จ่ายแล้ว | ต้องตรวจว่าตอนนี้คืนเงินจริงยังไง แล้วให้วิ่งผ่าน flow นี้ |

ลูกค้าเลือก:

1. **Credit back** → `CreditBackService` (มีแล้ว)
2. **ขอเงินคืน** → ดูจาก `payment_transactions.payment_method` ของ charge ที่จ่าย
   - `card` (KBank):
     - **คืนเต็มยอด charge → Void** `POST /card/v2/charge/{id}/void`
     - **คืนบางส่วน → Refund** `POST /card/v2/charge/{id}/refund` (ส่ง `amount`)
   - `qr` (KBank QR / Jagota QR) → ลูกค้าส่งบัญชีธนาคาร + รูปบุ๊คแบงก์ → ฝ่ายการเงินโอนคืน

### กฎ void / refund (ละเอียด)

| เงื่อนไข | ทำอะไร |
|---|---|
| ยอดคืน = ยอด charge ทั้งใบ และ charge ยังไม่ settle | Void |
| ยอดคืน = ยอด charge ทั้งใบ แต่ settle แล้ว (void ไม่ได้) | Refund เต็มยอด |
| ยอดคืน < ยอด charge | Refund ตามยอด |
| charge นี้เคย refund บางส่วนไปแล้ว | Void ไม่ได้อีก → Refund ส่วนที่เหลือ |
| charge อายุ 180–366 วัน | Refund ต้องส่ง `transaction_date` (YYYYMMDD) |
| charge อายุ > 366 วัน | KBank refund ไม่ได้ → fallback โอนเข้าบัญชี |

- **"เต็มยอด" นับต่อ charge ไม่ใช่ต่อ order** — split checkout (`payment_transaction_orders`) 1 charge จ่ายหลายออเดอร์ได้ คืนทั้งออเดอร์แต่ charge ครอบ 3 ออเดอร์ = คืนบางส่วนของ charge → Refund
- เช็ค settle ด้วย `inquiryTransaction` (`settlement_info`) ก่อน — ถ้า void แล้วได้ error ว่า settle แล้ว ให้ fallback เป็น Refund อัตโนมัติ ห้ามจบที่ fail

## 2. Edge cases

### 2.1 การเลือกวิธีคืน
- [ ] เลือกวิธีหลังเห็นยอดคืน (ตาม Figma) → มีสถานะ "รอเลือกวิธี"
- [ ] ลูกค้าไม่เลือกภายใน X วัน → เตือน → default เป็น credit back?
- [ ] ยอดเล็กมาก (เช่น < 100 บาท) → ให้ credit back อย่างเดียว ไม่เปิดโอน?
- [ ] เลือก credit back ไปแล้วอยากเปลี่ยนเป็นเงินสด → ให้ได้เฉพาะ CreditBack ที่ยังไม่ถูกใช้ (`remaining_amount = total_amount`) แล้ว cancel ใบเดิม
- [ ] เลือกเงินคืนแล้วอยากเปลี่ยน → ได้จนกว่าจะเริ่มยิง gateway / การเงินกด "กำลังโอน"
- [ ] B2B: ใน company/branch มีหลาย user — ใครมีสิทธิ์เลือกวิธี/กรอกบัญชี? สอง user กดพร้อมกันเลือกคนละแบบ → lock แถว refund, คนแรกชนะ
- [ ] ลูกค้าจ่ายแบบ credit term (`allowed_methods: ['credit']`) ไม่มี charge → ไม่มีเงินให้คืน → ลดยอดหนี้ / credit note ใน ERP แทน (ซ่อนตัวเลือก "ขอเงินคืน")
- [ ] ออเดอร์จ่ายผสม (เงินสด + CreditBack ที่ใช้ในออเดอร์ `order_credit_back_usages`) → ส่วน CreditBack คืนเป็น credit, เฉพาะส่วนเงินสดถึงจะคืนเงินได้ (ลำดับไหนก่อน — ต้องตัดสินใจ)
- [ ] ออเดอร์ที่ไม่มี payment_transaction `success` (ข้อมูลเก่า/import) → ซ่อน "ขอเงินคืน" หรือ fallback โอน

### 2.2 บัตร (KBank)
- [ ] หา charge ไม่เจอ / `gateway_charge_id` null → fallback โอน + แจ้ง ops
- [ ] `is_test = true` → ห้ามยิง prod key; ยิง sandbox เท่านั้น
- [ ] Register 3D charge (amount=1, KBank void เอง) → ไม่นับเป็น charge ที่คืนได้
- [ ] Gateway timeout / 5xx → สถานะ "ไม่ทราบผล" → **inquiry ก่อน retry** ห้ามยิงซ้ำตรง ๆ (คืนเงินซ้ำ)
- [ ] Idempotency: 1 refund = 1 คำสั่ง gateway; เก็บ `gateway_refund_id` + response; retry ต้องเช็คว่ายิงไปแล้วหรือยัง
- [ ] KBank ปฏิเสธ (card closed, ยอดเกิน, error code อื่น) → `failed` + เข้าคิว ops; ทางเลือก: retry / เปลี่ยนเป็นโอน / credit back
- [ ] ยอดคืนรวมทุกครั้งต่อ charge ≤ `amount` ของ charge (lock charge row ตอนคำนวณ)
- [ ] บัตรบริษัทที่บันทึกไว้ (`company-payment-card`) — เงินคืนเข้าบัตรใบที่จ่าย ไม่ใช่บัตรปัจจุบันของ branch
- [ ] บัตรหมดอายุ/ยกเลิกแล้ว → ธนาคารผู้ออกบัตรจัดการ แต่ต้องแจ้งลูกค้าว่าอาจใช้เวลา 7–45 วัน
- [ ] ผ่อน Smart Pay / Alipay / payment link (มี docs) — ถ้าเปิดใช้ ต้องเช็คว่า refund ได้แบบไหน; ถ้าไม่ได้ → โอน
- [ ] คืนหลายรอบใน charge เดียว (เคลม 2 ครั้ง + weight diff) → รอบแรก void ไปแล้ว รอบหลังไม่มีอะไรเหลือ — ต้องคำนวณก่อนเลือก void

### 2.3 QR → โอนเข้าบัญชี
- [ ] รายชื่อธนาคาร: เฉพาะไทย; รับ PromptPay แทนเลขบัญชีไหม?
- [ ] รูปแบบเลขบัญชีต่างกันตามธนาคาร (10 / 12 / 15 หลัก) — validate ตามธนาคาร
- [ ] ชื่อบัญชีต้องตรงกับชื่อบริษัท/ลูกค้าในระบบ? บัญชีส่วนตัวของพนักงานรับแทนบริษัทได้ไหม (policy)
- [ ] รูปบุ๊คแบงก์: ไม่ชัด / ไม่ใช่บุ๊คแบงก์ / ชื่อไม่ตรงที่กรอก → การเงิน reject พร้อมเหตุผล → ลูกค้าแก้แล้วส่งใหม่ (วนได้หลายรอบ)
- [ ] ไฟล์: จำกัดชนิด (jpg/png/heic/pdf) + ขนาด, ปฏิเสธไฟล์เสีย, กล้องถูกปฏิเสธสิทธิ์ → ให้เลือกจากคลังแทน
- [ ] โอนแล้วเด้งกลับ (บัญชีปิด/เลขผิด) → การเงิน mark `failed` → ลูกค้าแก้บัญชี → โอนใหม่
- [ ] การเงิน mark "โอนแล้ว" ต้องแนบสลิป + ยอด + วันที่โอน; ยอดในสลิปต้องเท่ายอด refund
- [ ] ลูกค้าแก้บัญชีหลังส่งไปแล้ว → ได้จนกว่าการเงินจะกด "กำลังโอน"
- [ ] ใช้บัญชีจาก refund ครั้งก่อนซ้ำได้ไหม (เก็บไว้ = ภาระ PDPA)
- [ ] SLA โอน (กี่วันทำการ) + เตือนการเงินเมื่อเกิน
- [ ] KBank Void QR (เฉพาะจ่ายผ่าน K PLUS) — **ไม่ทำ** ใช้โอนทางเดียวให้ flow เดียว

### 2.4 การคำนวณยอด
- [ ] ยอดคืนต่อชิ้นต้องหักคูปองแล้ว (`discount_inc_vat` เฉลี่ยตามสัดส่วนลงแต่ละบรรทัด) — ห้ามใช้ `product_price × qty` ตรง ๆ แบบ flow เดิม ไม่งั้นคืนเกินที่จ่าย
- [ ] จำนวนที่คืนได้ต่อบรรทัด = สั่ง − คืนไปแล้ว (นับทุก refund ที่ยังไม่ rejected) — คำนวณฝั่ง server ทั้งหมด ไม่รับ `amount` จาก client
- [ ] ค่าส่ง: คืนทั้งออเดอร์ → คืนค่าส่งด้วยไหม? คืนบางชิ้น → ไม่คืน?
- [ ] ปัดเศษสตางค์ (VAT) — คืนบางส่วนหลายรอบ ผลรวมต้องเท่ายอดจ่ายพอดี ไม่เกิน 1 สตางค์
- [ ] Cap รวมต่อออเดอร์: เงินสด + credit back ทุกที่มา (เคลม + weight diff + cancel) ≤ ยอดที่จ่าย
- [ ] สินค้าเดียวกันโดนทั้ง weight diff และเคลม → อย่าคืนซ้ำส่วนเดียวกัน (เคลมควรคิดจากยอด invoice จริงหลังหัก delta)
- [ ] invoice > order (หนักกว่า) → ไม่ใช่ refund, ไม่สร้างอะไร
- [ ] ยอด refund = 0 หรือติดลบ → ปฏิเสธตั้งแต่สร้าง

### 2.5 Credit back
- [ ] ออก CreditBack แล้ว claim ถูกยกเลิกภายหลัง → cancel ได้เฉพาะที่ยังไม่ใช้ (เหมือน `cancelForInvoice`)
- [ ] ลูกค้าใช้ CreditBack ในออเดอร์ใหม่ แล้วออเดอร์ใหม่นั้นถูกเคลม/ยกเลิก → `released_amount` คืนเข้าใบเดิม ห้ามแปลงเป็นเงินสด
- [ ] CreditBack มีวันหมดอายุไหม (ตอนนี้ไม่มี) — ต้องแจ้งในหน้าเลือกวิธี

### 2.6 Concurrency / ความถูกต้อง
- [ ] กดยืนยันซ้ำ / network retry → idempotency key ต่อ refund
- [ ] Admin อนุมัติซ้ำ 2 คน → lock row (`SELECT … FOR UPDATE`) + เช็คสถานะก่อนเปลี่ยน
- [ ] ยื่นคืนชิ้นเดิมพร้อมกัน 2 คำขอ → lock order ตอนคำนวณจำนวนที่คืนได้
- [ ] Weight diff: ใน `ingestInvoiceReceived` มีหมายเหตุไว้แล้วว่าถ้า request เข้ามาพร้อมกันอาจออกยอดเกินได้หนึ่งใบ — ถ้าจะให้คืนเป็นเงินสดได้ ต้อง lock order row
- [ ] Job ยิง gateway ล้มกลางทาง (ยิงสำเร็จแต่ save DB ไม่ทัน) → reconcile cron จับคู่จาก inquiry / KBank report

### 2.7 สถานะ / lifecycle
- [ ] สถานะที่เสนอ: `under_review → awaiting_method → processing → completed` + `rejected`, `failed` (failed กลับไป processing ได้) — weight diff / cancel ข้าม `under_review` ไป `awaiting_method` เลย
- [ ] ตารางใหม่แยกจาก `order_refunds` เดิม — ไม่ต้อง backward-compat กับ enum เดิม
- [ ] refund ถูก reject หลังลูกค้าเลือกวิธี/กรอกบัญชีแล้ว → ล้างข้อมูลบัญชีทิ้ง
- [ ] ออเดอร์ถูกยกเลิกระหว่างมีเคลมค้าง
- [ ] ลูกค้าขอลบบัญชี (PDPA) ระหว่าง refund ค้าง → เก็บข้อมูลการเงินตามกฎหมายบัญชี แต่ลบข้อมูลบัญชีธนาคาร/รูปเมื่อจบ

### 2.8 ยกเลิกออเดอร์ที่จ่ายแล้ว
- [ ] ยกเลิกก่อนส่ง (user / erp / system) → เต็มยอด → void (หรือ refund เต็มถ้า settle แล้ว) / QR → โอน
- [ ] ยกเลิก 1 ออเดอร์ใน split checkout → คืนบางส่วนของ charge → Refund
- [ ] ยกเลิกเพราะจ่ายเงินซ้ำ (ลูกค้าสแกน QR 2 ครั้ง) → คืน charge ที่ซ้ำ

### 2.9 แจ้งเตือน / UX
- [ ] แจ้งทุกครั้งที่เปลี่ยนสถานะ: อนุมัติ+ให้เลือกวิธี, ได้รับบัญชีแล้ว, บัญชีถูก reject, คืนบัตรสำเร็จ, โอนแล้ว (แนบสลิป), failed
- [ ] แสดงระยะเวลาที่คาดว่าจะได้เงิน ตามวิธีที่เลือก (void ทันที / refund บัตร 7–45 วัน / โอน X วันทำการ)
- [ ] เลขบัญชีในแจ้งเตือน/หน้าจอแสดงแบบ mask (xxx-x-x1234-x)
- [ ] TH/EN ตาม `preferred_language`

### 2.10 Security / PDPA
- [ ] Authz: เปิด/แก้ refund ได้เฉพาะเจ้าของ (user หรือ company/branch ที่มีสิทธิ์)
- [ ] เลขบัญชีเข้ารหัส at rest; รูปเก็บ bucket private + signed URL อายุสั้น; ดูได้เฉพาะ role การเงิน
- [ ] Audit log ทุก action ของการเงิน/CS (ใครอนุมัติ ใครโอน ยอดเท่าไร)
- [ ] Rate limit endpoint ส่งบัญชี/อัปโหลด
- [ ] ข้อความยินยอม (Payment Refund Terms) — เก็บเวอร์ชัน + เวลา ที่ลูกค้ากดยอมรับ
- [ ] Retention: ลบรูปบุ๊คแบงก์หลัง completed + N วัน

### 2.11 ERP / บัญชี
- [ ] ใบลดหนี้ (Credit Note) ใน ERP สำหรับทุก refund ที่ออกใบกำกับภาษีไปแล้ว — ใครออก, ส่ง event ไหน (`credit_notes` เป็นคนละตัวกับ CreditBack)
- [ ] ค่าธรรมเนียม MDR ของ KBank ตอน refund ใครรับ
- [ ] กระทบยอด refund รายวันกับ settlement report ของ KBank
- [ ] ส่ง event `order.refund.*` ให้ commerce ไว้ทำรายงานเท่านั้น — commerce ห้ามอยู่ใน path คืนเงิน

### 2.12 Ops
- [ ] KBank ล่ม → เข้าคิว retry มี backoff + แจ้งเตือน; หน้า admin มีปุ่ม retry / เปลี่ยนวิธี
- [ ] Feature flag (default off) ตามกฎ josh — เปิดทีละวิธีได้ (credit back → card → bank transfer)
- [ ] Sandbox test case ครบทุกแถวในตาราง void/refund ก่อนขึ้น prod

## 3. ต้องแก้ฝั่งไหน

| ฝั่ง | repo | งาน |
|---|---|---|
| **josh backend** (หลัก) | jagota/Webjosh `apps/backend` | ตาราง refund ใหม่ + state machine, คำนวณยอด, KBank void/refund + inquiry/reconcile, เก็บบัญชี/รูป (เข้ารหัส), API ลูกค้า + admin, แจ้งเตือน, weight diff เปลี่ยนจากออก CreditBack อัตโนมัติ → สร้าง refund รอเลือก (หลัง flag), ส่ง event `refund.*` ให้ commerce |
| **Mobile app** | jagota/Mobilejosh | หน้าจอตาม Figma: เลือกวิธี, บัญชี+ถ่าย/อัปโหลดบุ๊คแบงก์, terms, Refund Detail (Processing / Completed) — มี `lib/refund-map.ts`, `lib/order-refund-rows.ts` ของ flow เดิมอยู่ ต้องเขียนใหม่ |
| **shop-web** | Webjosh `apps/shop-web` | ถ้าลูกค้าเว็บต้องเลือกวิธีคืนได้ด้วย (Figma มีแค่ mobile — ต้องตัดสินใจ) |
| **commerce-platform** | repo นี้ | (1) ERP invoice เข้า commerce ก่อนอยู่แล้ว (`POST /credit-backs/invoice-received` → relay `erp.credit_back.invoice_received` → josh) — **ไม่ต้องแก้ relay**, logic delta อยู่ josh ตามกฎ "ERP business logic อยู่ josh" (2) เพิ่ม path refund admin ใน `AREAS` ของ `josh-admin-call.controller.ts` (3) รับ event `refund.*` ไว้ทำรายงาน (optional, ทีหลัง) |
| **commerce-admin** | repo นี้ `apps/commerce-admin/src/josh-admin` | หน้าคิว refund ของการเงิน (ดูบุ๊คแบงก์, approve/reject บัญชี, mark โอนแล้ว + สลิป, retry บัตร) เรียก josh ผ่าน `/j/*` relay — ต้องเพิ่ม route ใน josh `RELAY_ROUTES` ด้วย |
| **ERP** | ภายนอก | ใบลดหนี้ (credit note) ต่อ refund — ต้องคุยว่าใครออก |

ข้อสังเกต:
- invoice ผ่าน commerce ก่อน → ถ้า josh ล่ม commerce เก็บ+retry ให้ refund weight diff แค่ช้า ไม่หาย
- ดูเลขบัญชี/รูปบุ๊คแบงก์ = PII → ใน `AREAS` ตอนนี้ PII ให้แค่ admin; ต้องเพิ่ม role `finance` หรือให้ admin เท่านั้น
- `web-admin` ของ josh ไม่ต้องทำหน้าใหม่ (admin ย้ายมา commerce-admin แล้ว)

## 4. ต้องตัดสินใจ

1. คืนสินค้า/ของเสีย: ใครเป็นคนสร้าง refund (ลูกค้ายื่นในแอป หรือ CS สร้างใน web-admin) และใครอนุมัติ
2. Weight diff: default เมื่อไม่เลือก + ยอดขั้นต่ำที่ให้ขอเงินสด
3. คืนบัตร: ยิงอัตโนมัติ หรือรอการเงินอนุมัติ
4. ออเดอร์จ่ายผสม (เงินสด + CreditBack): คืนส่วนไหนก่อน
5. ค่าส่ง + ส่วนลดคูปอง: คืนยังไง
6. Policy ชื่อบัญชี (ต้องตรงชื่อบริษัท?) + SLA โอน
7. ERP credit note: ใครออก เมื่อไร
8. shop-web ต้องมี flow เลือกวิธีคืนด้วยไหม หรือ mobile อย่างเดียว
9. ใครดูบัญชี/บุ๊คแบงก์ใน commerce-admin ได้: เพิ่ม role `finance` หรือ admin เท่านั้น
