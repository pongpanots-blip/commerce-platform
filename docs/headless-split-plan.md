# แผนแยก josh เป็น headless storefront — อะไรย้าย อะไรอยู่

> สำรวจโค้ด josh ทั้ง repo (origin/main `0742dc4ff`, 2026-10-05) — backend 86 module, entity 152 ตัว, Mongo 5 schema, migration 253 ไฟล์, shop-web / web-admin / landing-web / docs-web, libs, `cms/`, docs · รวม ~496k บรรทัด TS
> **สถานะ: ข้อเสนอ — ยังไม่ได้ตัดสิน** · กฎเดิมยังใช้: ห้ามหยุด/ลบอะไรของ josh จนกว่า commerce ขึ้น prod

## 0. เป้าหมาย

| | หน้าที่ | หลักการ |
|---|---|---|
| **commerce** | ระบบหลัก (system of record) + หลังบ้าน: สินค้า ราคา โปรโมชัน สต็อก ลูกค้า/บริษัท order การชำระเงิน บัญชี ERP/Jagota รายงาน marketing engine AI | รับการ**เขียน**ทั้งหมด · ส่ง event ให้ platform |
| **josh** | หน้าร้าน (shop-web, landing, mobile API) + CMS + login + ตัวกลางให้หน้าบ้าน (BFF) | **อ่านจากสำเนาในเครื่องตัวเอง**ที่ commerce ส่ง event มาอัปเดต — ไม่เรียก commerce ตอนลูกค้าเปิดหน้า · เรียก commerce สดเฉพาะ "สั่งซื้อ/จ่ายเงิน" |

ข้อตกลงที่ต้องยอมรับ: หลังย้าย checkout แล้ว commerce ล่ม = ดูสินค้าได้แต่สั่งซื้อไม่ได้ → commerce ต้อง HA ก่อนถึงขั้นนั้น

## 1. ข้อเท็จจริงที่กำหนดแผน

1. **มี mobile app ภายนอกใช้ `/api/*` และไม่มี API versioning / ไม่มี force update** → ห้ามเปลี่ยน URL · josh เก็บ path เดิมทั้งหมดเป็น façade แล้วส่งต่อ commerce ข้างหลัง (frontend ไม่ต้องแก้)
2. **ราคาตามลูกค้า/สาขาคำนวณในทุกหน้า** (`shared/helpers/pricing-scope.helper.ts` ใช้ใน listing, search, carousel, cuisine, promotion-page, cart) → josh ต้องมี projection "ราคาที่สาขานี้เห็น" ตั้งแต่วันแรกที่ย้าย pricing
3. **ตารางแกนถูกใช้กว้างมาก:** `users` 32 module · `orders` 19 · `product_inventory` 18 · `company` 17 · `branch` 16 → ทุก module ที่แตะต้องได้สำเนาหรือ event แทน
4. **staff กับลูกค้าอยู่ตาราง `users` เดียว ใช้ JWT ชุดเดียว** (guard อ่าน `role`) · JWT ทุกใบออกโดย josh
5. **`cms/` (Strapi) เป็น demo ที่ไม่ได้ deploy** มีแค่ article · CMS จริงของ josh วันนี้คือ 11 ตาราง backend + หน้า web-admin → ใช้ของเดิมเป็น CMS ไม่ต้องย้ายไป Strapi ตอนนี้
6. **ทิศนี้ถูกเลือกไว้แล้วในเอกสาร josh** (`docs/superpowers/specs/2026-07-1x-commerce-platform-*`: commerce = single source of truth, `/api/v1/storefront/*`) และเริ่มแล้ว (ERP ผ่าน commerce, `app/commerce-platform/` ใน josh)
7. **schema ของ josh มีสองแหล่ง:** migration + `database/schema-bootstrap.service.ts` (CREATE IF NOT EXISTS ตอน start) + สคริปต์ SQL ~100 ตัวที่ถือว่า DB เดียว

## 2. ทุก module ไปฝั่งไหน

**ย้ายไป commerce (COMMERCE)**
- สินค้า/ราคา: `pricing`, `promotion-mechanic-usage`, `promotion-product-set`, `coupon`, `supplier`, `competitor-prices`, `marketing-research`, `dbd`, `restaurant-place`, `target-area`
- order/เงิน: `payment`, `billing`, `credit-back`, `credit-note`, `refunds`, `erp-log`, `events` (outbox), `order-targetgroup`, `purchases-dashboard`, `membership-tier`
- ลูกค้า/หลังบ้าน: `kyc`, `pii`, `customer-import`, `cs-admin`, `cs-crm-claims`, `winback`, `push-campaign`, `internal-docs-library`, `webhook` (Zendesk/support หลังบ้าน), `shared/pdf`, `shared/notification` (OneSignal)

**อยู่ josh (JOSH)**
- CMS: `banner`, `carousel`, `copy`, `figma-sync`, `trusted-brand`, `trusted-user`, `cuisine`, `marketing-link`, `smart-link`, `popup-definition`*, `web-brand`*, หน้า legal/policies/about, landing SEO, articles (Strapi demo)
- หน้าร้าน: `search` (ต้องเร็ว), `livechat`, `cache-warmup`, `shared/revalidate`, `users` (สำเนา), `commerce-platform` (กลายเป็น client ของ commerce สำหรับ checkout)
- `customer-metrics` เหลือแค่ตัวรับ (ทำแล้ว)
- (*ไม่มี frontend เรียก — ตรวจซ้ำแล้วอาจเลิกใช้)

**แยกสองส่วน (SPLIT)**

| module | → commerce | อยู่ josh |
|---|---|---|
| `product`, `product-category`, `brand` | การเขียน, อนุมัติจาก ERP, รูป, taxonomy | listing / facets / PDP / เมนูหมวด จากสำเนา |
| `promotion-page`, `campaign` | ส่วนการค้า (คูปอง, mechanic) | layout หน้า, banner ที่ผูก |
| `orders` | สร้าง order, state machine, วงเงิน, shipment, admin, import | checkout BFF (quote/validate/prepare, เลือกรอบส่ง), "order ของฉัน" จากสำเนา |
| `cart` | กติการาคาและการจอง pre-order | ตะกร้าใน Redis (หน้าร้าน) |
| `jagota-order` | ส่ง order/ยกเลิก, probe, token, sync ลูกค้า, 3PL | สำเนา `delivery_calendar`, `sku_order_period`, `supplier_order_period` |
| `erp` | สถานะ order/invoice/quotation | ตัวรับ event (`internal/erp-events` ทำแล้ว) สำหรับสำเนา |
| `auth` | ลบบัญชี, push ลูกค้าไป ERP | login, OTP, refresh, device, session (**ต้องอยู่ josh**) |
| `company`, `onboarding`, `profile-settings` | ข้อมูลบริษัท/สาขา/ราคาส่วนตัว, DBD, ERP, การชำระ | UI, OTP, หน้า content, สำเนา |
| `user-segment` | eligibility ของคูปอง/โปรโมชัน | นิยาม segment สำหรับ banner |
| `marketing-workflow`, `notification` | engine, enrollments, offers, การส่งแจ้งเตือน | เก็บ page-view, offer ที่ active, feed, legal (สำเนา) |
| `analytics` | funnel, timeline, รายงาน | รับ event จากหน้าร้าน |
| `bot` | tool ที่ดู order/บัญชี (เรียก commerce หรือ MCP) | UI แชท, flow, template |
| `admin-audit`, `seed`, `jobs`, `upload` | ส่วนของตัวเอง | ส่วนของตัวเอง |

**ใช้ร่วม (SHARED-LIB):** `cron-lock`, `redis-cache`, websocket adapter, interceptor/redaction, request-context, api-log writer, media utils — แยกเป็น lib กลาง (redaction กับ cron-lock ต้องตรงกันเป๊ะ)

**เลิกใช้หลัง commerce ขึ้น prod:** `metric`, `migration-import`, seed mock dashboard, `ProductSyncService` แบบสแกนทั้งแค็ตตาล็อก, bestseller SUM ใน josh, `admin-access` (ไป SSO), entity ไร้เจ้าของ (`branch_special_price`, `product_branch_specials`, `claims`, `claim_items`), `render.yaml`

**หน้า admin (145 route):** ~50 ย้ายไป commerce-admin (order, ลูกค้า, สินค้า, ราคา, คูปอง, บัญชี, ERP) · ~46 อยู่ josh (หน้าแรก, banner, carousel, promotion page, copy, SEO, legal, bot) · ~40 แยก

## 3. ลำดับย้าย (แต่ละขั้นถอยกลับได้)

| ขั้น | อะไร | ทำไมลำดับนี้ |
|---|---|---|
| **0. ฐาน** | commerce ขึ้น prod · event bus commerce→josh สำหรับสำเนา (ขยายจาก `internal/erp-events`) · lib กลาง · commerce เชื่อ JWT ของ josh (JWKS) · แบบ façade ใน josh สำหรับ path เดิม | ทุกขั้นต่อจากนี้ต้องใช้ |
| **1. หลังบ้านล้วน** ✅ บางส่วน (ดูหัวข้อ 6) | supplier, dbd, restaurant-place, winback, internal-docs, erp-log, refunds, order-targetgroup, purchases-dashboard, รายงาน analytics, push-campaign (+ competitor/research ที่พักไว้) | ไม่มีเส้นทางหน้าร้าน เสี่ยงต่ำ พิสูจน์ commerce-admin |
| **2. ERP/Jagota** | สถานะ order/invoice, ส่ง order ไป Jagota, probe, รอบส่ง → event ให้ josh | ต้องมีก่อน order ย้าย |
| **3. สินค้า + ราคา** | commerce เป็นเจ้าของ · josh สร้างสำเนาแค็ตตาล็อก + ราคาต่อสาขา · **เทียบผลคู่กัน (shadow compare) ก่อนสลับ** | หน้าร้านเร็วเท่าเดิมได้ต้องมีสำเนาก่อน |
| **4. ลูกค้า/บริษัท** | master, KYC, วงเงิน · onboarding เขียนผ่าน commerce · staff ไป SSO | ต้องมีก่อน checkout |
| **5. บัญชี** | invoice, receipt, credit back/note (commerce ออกเลขฝั่งเดียว) | ก่อนการชำระเงิน |
| **6. Checkout** | order + การชำระเงิน + คูปอง/flash sale + outbox **ย้ายพร้อมกันครั้งเดียว** · josh เหลือ cart + checkout BFF · commerce ต้อง HA | ผูกกันแน่นใน `orders.service.ts` (6k บรรทัด) |
| **7. Marketing engine** | workflow, segment eligibility, การส่งแจ้งเตือน · josh เหลือสำเนา offer/feed | ต้องใช้ order + ลูกค้า |
| **8. เก็บกวาด** | ลบของที่ย้ายแล้วออกจาก josh | หลัง commerce เสถียร |

## 4. จุดเสี่ยง

**เงิน / ความถูกต้อง**
- **บั๊กที่มีอยู่แล้ว** (`commerce-platform-order.service.ts`, ปิดอยู่ด้วย `COMMERCE_PLATFORM_SYNC_ENABLED`): จองสต็อกใน commerce ก่อนเริ่ม transaction ของ josh และไม่มี API ยกเลิกการจอง → transaction ล้ม/josh ล่ม = สต็อกค้าง · แจ้ง commerce เฉพาะ `paid` ไม่แจ้งหมดเวลา/ยกเลิก → **ต้องแก้ก่อนเปิด flag**
- การยืนยันจ่ายเงิน (`claimTransactionPaid`) กันซ้ำด้วยการเช็คสถานะก่อนหน้า — webhook KBank/Jagota และ reconcile cron แข่งกันได้ · ช่วงย้ายให้ฝั่งเดียวเป็นเจ้าของ webhook + reconcile
- ส่ง order ไป ERP: ERP ปฏิเสธเลข order ซ้ำ ("Magento Order Id is already used" ซึ่ง josh นับเป็นส่งแล้ว) แต่ไม่มีอะไรอื่นกันส่งซ้ำ — ย้ายต้องพา `jagota_order_sync` ไปด้วย
- เลข credit back ใช้ `MAX+1` → commerce ออกเลขฝั่งเดียว
- flash sale จองโควตาตอน checkout และคืนจาก ~6 จุด → ย้ายพร้อม checkout เท่านั้น
- คูปองที่ workflow แจกต้อง idempotent ข้ามระบบ

**รันซ้ำ**
- cron ที่ต้องปิดฝั่ง josh ทันทีที่ commerce รันตัวเดียวกัน (ส่วนใหญ่ไม่มี lock): `order-payment-expiry`, `kbank-reconcile`, `jagota-qr-reconcile`, `invoice-overdue-notify`, `order-settled` sweep, `jagota-auth-token`, probe ทั้งสอง, `supplier-order-period-poll`, `jagota-delivery-date-cache`, `customer-metrics`
- queue ที่ต้องมีตัวรันตัวเดียว: marketing, ERP inbound (concurrency 1), notify · cron-lock ใช้ Redis key ร่วม → ตั้ง namespace

**หน้าร้าน / ความเร็ว**
- `GET product/:id/live-price` เรียก ERP สดทุกครั้งที่เปิดหน้าสินค้า (ผิดกฎอยู่แล้ววันนี้) → ใช้สำเนาสต็อกแทน หรือเรียกเฉพาะตอน checkout
- `product_inventory` เขียนจาก 7 จุด, `private_price` จาก 5 จุด → กำหนดเจ้าของเดียวก่อนย้าย
- cache หน้าร้าน 60–300 วิ → commerce เปลี่ยนแล้ว josh ต้องยิง revalidate **หลัง**อัปเดตสำเนาเสร็จ
- carousel ขายดีอ่าน `order_items` ตรง → ใช้ event อันดับขายดี (มี `BestsellersOffloadJob` แล้ว)
- offers/active และ feed แจ้งเตือนอยู่ในเส้นทางหน้าร้าน → ต้องอยู่ในเครื่อง josh

**ข้อมูล / ID**
- `user.id` / company id ต้องเหมือนกันทั้งสองฝั่ง (OneSignal, feed, analytics อ้าง id ของ josh) · URL SEO ใช้ id/slug ของ josh
- ลูกค้าอีเมลซ้ำ: `upsertCustomer` จับคู่ด้วยอีเมล/เบอร์
- ERP customer push ถูกเรียกจาก auth และ onboarding — ช่วงย้ายถ้าทั้งสองฝั่ง push จะได้ custcode ซ้ำ
- frontend 7 จุดเรียก `fetch` ตรงไม่ผ่าน `shared-api`

**จากโค้ด josh ใหม่ (#442–#453, 2026-10-05) — ไม่มี migration, ไม่กระทบตารางที่ commerce อ่าน แต่เพิ่มกติกาที่ต้องพาไปด้วย**
- **ห้ามตอบ 403 กับ mobile** (#448): mobile ถือว่า 403 = session หมด แล้ว logout → order นอกสิทธิ์ตอบ 404 + `error_code` · façade ใน josh ต้องแปลง 403 จาก commerce เป็น 404 เสมอ
- **ตะกร้าผูกกับ user** (#451): ลูกค้าที่ login ใช้ cart id `user:<userId>` ร่วมกันทุกเครื่อง · cart อยู่ josh ตามแผน แต่การจอง pre-order ที่ย้ายไป commerce ต้องรู้จัก id แบบนี้
- **staff เห็นเฉพาะ order ที่ตัวเองสั่งในสาขาตัวเอง** (#444) · commerce ต้องใช้ scope เดียวกันตอนย้าย order
- **คูปองลดทั้งตะกร้าเสมอ ขอบเขตใช้แค่เช็คสิทธิ์** (#445) และคูปอง auto-apply ยกเลิกเลือกได้ (#447) · ย้ายคูปองต้องตรงกติกานี้
- **cutoff ส่ง D+1: แสดง 17:00 ล็อก 17:30** (#450, `shared/helpers/next-delivery-date.helper.ts`) · ย้าย checkout ต้องใช้ตัวเดียวกัน
- scraping ยัง active (retry/resume #442 #453, คอลัมน์ใน jsonb `progress`) → การย้าย competitor/scraping ยังพักไว้ตามเดิม

## 5. ขนาด (ประมาณการหยาบ)

backend josh ~253k บรรทัด · โค้ดที่ย้ายหรือแยกราว ครึ่งหนึ่ง · ขั้น 0–2 หลักสัปดาห์ · ขั้น 3–5 ขั้นละ 1–2 เดือน · ขั้น 6 2–3 เดือน · ทั้งหมดหลายเดือนถึงปีขึ้นกับคนและการที่ทีม josh ยังเพิ่มฟีเจอร์ — **ต้องตกลงว่าฟีเจอร์ใหม่ในโดเมนที่จะย้าย ทำที่ commerce เลย** ไม่งั้นไล่ไม่ทัน

## 6. ความคืบหน้า

**ขั้น 1 — ทำแล้วใน commerce (อ่านจาก replica ของ josh, josh ไม่ต้องแก้อะไร)**
| ของ josh | ใน commerce | สิทธิ์ |
|---|---|---|
| `purchases-dashboard` (มุม internal) + analytics funnel | commerce-admin › รายงานร้าน › ยอดขาย / Traffic · `GET /api/reports/sales\|traffic` · MCP `shop_sales`, `shop_traffic` | ยอดขาย: admin · traffic: marketing |
| (ใหม่) สุขภาพระบบ | รายงานร้าน › Error / สุขภาพระบบ · `GET /api/reports/health` · MCP `system_health` (ใช้ `SystemHealthReport` ตัวเดียวกัน) | admin |
| `order-targetgroup` | รายงานร้าน › Order target group · `GET /api/reports/order-targetgroup` | admin |
| `restaurant-place` (Market Explorer) | Marketing › Market Explorer · `GET /api/reports/restaurants[/export\|/:id]` · MCP `restaurant_places` | marketing |

ต่างจาก josh: Market Explorer กรอง "คนเยอะช่วง…" ใน SQL (josh โหลดทั้งตารางมากรองใน JS) และใช้วันในสัปดาห์ตามเวลาไทย (josh ใช้ UTC → ก่อน 07:00 เป็นของเมื่อวาน)

**ขั้น 1 — ยังไม่ย้าย และเหตุผล**
- `purchases-dashboard` มุมลูกค้า (บริษัทดูยอดซื้อตัวเอง, export Excel ทางอีเมล): ลูกค้าเรียกจากหน้าร้าน/แอป → ต้องรอ façade ขั้น 0
- `supplier`, `internal-docs-library`: มีการเขียน — ย้ายตอนนี้ = เขียนสองที่ · รอ commerce ขึ้น prod แล้วสลับเจ้าของทีเดียว
- `winback`, `push-campaign`: ส่งข้อความ/แจ้งเตือนจริง · ทำล่วงหน้าได้แค่แบบปิดไว้ (default-off) จนวันสลับ
- `dbd`: เรียก API กรมพัฒนาฯ ตอน onboarding (เส้นทางลูกค้า)
- `erp-log`: อยู่ใน Mongo ของ josh ที่ commerce อ่านไม่ได้ · ฝั่ง commerce มี Inbound log ของตัวเองแล้ว
- `refunds`: มีแค่หน้า "คำขอคืนเงินของฉัน" ของลูกค้า (หน้าร้าน)

**ส่ง order ไป Jagota ผ่าน commerce (3 ขั้น)**
1. ทดลองคู่กัน (shadow) — commerce สร้าง request ของ order ที่ josh ส่งแล้วเทียบทีละช่อง · ไม่ส่งอะไร · ERP › "ส่ง order ผ่าน commerce (ทดลอง)" · MCP `jagota_shadow` · `CRON_JAGOTA_SHADOW_ENABLED`
2. ส่งจริงผ่าน commerce — josh ยังสร้าง request + gate + `jagota_order_sync` + retry เอง ย้ายแค่ HTTP call: josh `JAGOTA_VIA_COMMERCE_BRANCHES` (ปิด) → commerce `POST /api/v1/storefront/jagota/order-create` (API key ของ josh) → Jagota · commerce เก็บ 1 แถวต่อเลข order (`jagota_order_sends`) ส่งซ้ำไม่ได้: ส่งแล้ว = ตอบของเดิม, กำลังส่ง = in_flight · commerce ปิด/ล่ม → josh ส่งตรงเหมือนเดิม · ฝั่ง commerce เปิดด้วย `JAGOTA_GATEWAY_ENABLED` + `JAGOTA_NODEAPI_*`
3. ย้ายประวัติ `jagota_order_sync` มา commerce — สำเนาครบทุกคอลัมน์ใน `jagota_order_sync_history` (+เลข order) · ดึงของใหม่ทุก 5 นาที + อ่าน 3 วันล่าสุดซ้ำ (josh แก้แถวเดิมและไม่มี updated_at) · ERP › "ประวัติส่ง ERP" · MCP `jagota_shadow` (`orderNumber`) · `CRON_JAGOTA_SYNC_IMPORT_ENABLED` · josh ยังเขียนตารางของตัวเองตามเดิม

**สินค้าและราคา (ข้อ 3)** — ทุกอย่างปิดไว้ (default off)
- ทดลองคิดราคาคู่กัน: commerce คิดราคาทุกบรรทัด order ของ josh ด้วยโค้ดราคาของ josh (สำเนา) แล้วเทียบ · รายงานร้าน › ราคา: commerce คิดคู่กัน · MCP `price_shadow` · `CRON_PRICE_SHADOW_ENABLED`
- ราคาลูกค้า / ราคาสัญญา: commerce เป็นที่เก็บหลัก (`staff_prices`) → josh บันทึกผ่าน PrivatePriceService / BranchPricingService (ล้าง cache ราคาเอง) · ราคาที่ josh สร้างเอง (ใบเสนอราคา ERP, คำขอราคา CS) ดึงเข้ามาด้วย import (`CRON_STAFF_PRICES_IMPORT_ENABLED`) · MCP `staff_prices`
- อนุมัติข้อมูลสินค้าจาก ERP: ปุ่มในหน้า สินค้า (josh) → josh ProductService approve / reject
- ข้อมูลสินค้าหลัก (ชื่อ รายละเอียด หมวด หน่วย ราคาขาย/ตั้ง สถานะ): ปุ่ม "แก้ข้อมูลสินค้า" ในหน้า สินค้า (josh) → josh `internal/commerce/products` action `update` → ProductService.update (ตัวเดียวกับฟอร์ม admin ของ josh) · ดึงสำเนา `josh_catalog_products` ทันทีหลังแก้ · รูปยังอยู่ที่ josh · สวิตช์ josh `COMMERCE_OWNS_CATALOG` ล็อกการสร้าง/แก้ฟิลด์สินค้าใน josh
- สวิตช์ฝั่ง josh: `COMMERCE_OWNS_PRICES` (ล็อกหน้าแก้ราคาใน josh, live-price ไม่เขียนทับราคา, MOQ ต้องอนุมัติ) · `COMMERCE_APPROVES_PRODUCTS` (ล็อกปุ่มอนุมัติใน josh)
- ลำดับเปิด: price shadow ตรง 100% → import ราคาครั้งแรก → เปิด COMMERCE_ACTIONS_ENABLED → COMMERCE_OWNS_PRICES → COMMERCE_APPROVES_PRODUCTS → COMMERCE_OWNS_CATALOG

