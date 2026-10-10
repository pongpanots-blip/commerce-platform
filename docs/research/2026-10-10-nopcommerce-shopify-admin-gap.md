# nopCommerce + Shopify admin — ฟีเจอร์ที่ควรนำมาปรับใช้กับ commerce-platform

- **วันที่:** 2026-10-10
- **แหล่งที่ดู:**
  - nopCommerce admin demo — `https://admin-demo.nopcommerce.com/Admin` (บัญชี demo สาธารณะ)
  - Shopify admin — ร้านทดลอง `nqhawa-19` (ภาษาไทย, ยังไม่มีสินค้า/ออเดอร์, ยังไม่เลือกแผน)
- **วิธีดู:**
  - nopCommerce: ไล่ครบทุกเมนูใน sidebar (104 ลิงก์) + หน้าแก้ไขหลัก (สินค้า, ออเดอร์, ลูกค้า, หมวดหมู่, ส่วนลด, vendor, affiliate, store, topic, message template, menu, blog) รวม 121 หน้า ดึงหัวข้อการ์ด แท็บ label ของฟอร์ม คอลัมน์ตาราง และปุ่ม
  - Shopify: เปิดทีละหน้า ~40 หน้า (เมนูหลักทั้งหมด + ฟอร์มสร้างสินค้า/ส่วนลด/บริษัท/PO/transfer/gift card/segment/collection + หน้า Settings หลัก)
- **ข้อจำกัด:**
  - Shopify ร้านว่าง เห็นแค่ฟอร์มกับ empty state ไม่เห็นหน้า detail ที่มีข้อมูลจริง
  - หน้า abandoned checkouts (`/checkouts`) ขึ้น "ฟีเจอร์นี้ไม่พร้อมใช้งานในแผนของคุณ"
  - "เรามีหรือยัง" อิงจากการค้นโค้ดใน repo นี้ หน้า `/j/*` เป็นหน้า Josh ที่ relay ผ่าน commerce จึงนับว่า "มี" แต่ข้อมูลอยู่ฝั่ง Josh

---

## สรุปสั้น: 10 อันดับที่แนะนำ

บริบทที่ใช้จัดลำดับคือ Jagota/Josh เป็น **B2B ขายส่งอาหาร** (ลูกค้าเป็นร้านอาหาร/บริษัท, มีเครดิตเทอม, มี sales rep) และ commerce-platform กำลังเป็น **hub กลางหลายแพลตฟอร์ม** ที่จะมี WMS ของตัวเองในอนาคต

| # | ฟีเจอร์ | ได้แนวคิดจาก | ทำไมคุ้ม | เรามีอะไรแล้ว | ขนาดงาน |
|---|---|---|---|---|---|
| 1 | **หน้าดู Activity / Audit log** | nop Activity log + Activity types, Shopify "บันทึกกิจกรรมของร้านค้า" | มี entity เก็บอยู่แล้วแต่ไม่มีหน้าดู ใช้ตอบคำถาม "ใครแก้ราคา/สิทธิ์เมื่อไหร่" | `core/audit/audit-log.entity.ts` (เขียนจาก staff-accounts, MCP, ERP simulator) | S |
| 2 | **หน้า Scheduled tasks** | nop Schedule tasks: ชื่อ, รอบเวลา, เปิด/ปิด, stop on error, เริ่ม/จบ/สำเร็จล่าสุด, **Run now** | cron ~11 ตัวเปิดปิดด้วย env มองไม่เห็นใน UI ตอนพังรู้ช้า | `src/config/cron.config.ts`, `/sync-jobs` | S–M |
| 3 | **Saved views + เลือกคอลัมน์ + ตัวกรองบนหน้า list** | Shopify (ทุก list: "บันทึกเป็นมุมมองใหม่ ⌘S", คอลัมน์, จัดเรียง) | หน้า list ของเราเยอะมาก (ออเดอร์, ลูกค้า, ราคา) แต่ละ role ดูคนละมุม | ไม่พบ | M (ทำเป็น component กลางใน `libs/ui`) |
| 4 | **Quote / Draft order → ส่งใบแจ้งหนี้ → แปลงเป็นออเดอร์** | Shopify draft orders ("ส่งใบแจ้งหนี้", เพิ่มรายการกำหนดเอง, ส่วนลด, ค่าส่ง), nop RFQ + Quotes (สถานะ: ลูกค้าขอ → ร้านสร้าง → ส่งให้ลูกค้า → เป็นออเดอร์ → หมดอายุ) | B2B ต่อรองราคาเป็นเรื่องปกติ ตอนนี้ price request กับ "สั่งแทนลูกค้า" แยกกันอยู่ | `/j/price-requests`, `/cs/orders/new` | M |
| 5 | **ตั้งค่าระดับบริษัท B2B** | Shopify Companies: payment terms (ทันที/7/15/30/45/60/90 วัน), catalog ต่อ location, "ส่งทุกออเดอร์เป็น draft เพื่อตรวจ", tax ID/ยกเว้นภาษี, external ID | ผูกราคา/สินค้าที่เห็นได้ และ flow อนุมัติออเดอร์ต่อบริษัท | `/j/company`, `/j/credit-terms`, `/review/orders/*`, entity `price-list` (ยังไม่มี controller) | M–L |
| 6 | **กู้ตะกร้าที่ค้าง (abandoned cart)** | nop "Shopping carts and wishlists" (ดูตะกร้าปัจจุบันของทุกลูกค้า), Shopify segment "checkout ไม่เสร็จใน 30 วัน" + abandoned checkouts | เป็น trigger ของ marketing workflow ที่มีอยู่แล้ว | `reservation-expiry.worker.ts` (คืนสต็อก ไม่ได้ตามลูกค้า), marketing-workflow | M |
| 7 | **Low stock: แจ้งเตือน + action อัตโนมัติ** | nop ต่อสินค้า: "Notify for qty below", "Low stock activity" (ไม่ทำอะไร / ปิดปุ่มซื้อ / unpublish), รายงาน Low stock | ลดการขายของที่ไม่มีจริง | stock moves, ERP stock, back-in-stock notify (`/j/cs/product-notify-funnel`) | S–M |
| 8 | **Import/Export CSV แบบมาตรฐานทุกหน้า list** | ทั้งคู่มี Export/Import บนสินค้า หมวดหมู่ ลูกค้า ออเดอร์ สต็อก แค็ตตาล็อก ผู้ใช้ | ทีม merch/marketing ทำงานเป็นไฟล์อยู่แล้ว | export บางจุด (`shop-reports.controller.ts`, competitor prices), bulk image upload | M |
| 9 | **Order notes / timeline (ติ๊ก "แสดงให้ลูกค้าเห็น")** | nop Order notes: ข้อความ, แนบไฟล์, Display to customer | CS กับ sales คุยเรื่องออเดอร์เดียวกัน ตอนนี้ไม่มีที่บันทึกร่วม | ไม่พบใน commerce (อาจมีฝั่ง Josh) | S |
| 10 | **Purchase order + Transfer + สถานะสต็อกหลายชั้น** | Shopify: PO (ซัพพลายเออร์, ปลายทาง, เงื่อนไข, สกุลเงิน, ค่าใช้จ่ายเพิ่ม, เลขอ้างอิง, สแกนบาร์โค้ด), Transfer, สต็อกแยก มีอยู่/พร้อมขาย/จัดสรรแล้ว/กำลังนำเข้า/ไม่พร้อมขาย | ปูทางให้ WMS ของเราเอง | `commerce/inventory` (receive/adjust/transfer), `/order-periods`, supplier | L |

---

## รายละเอียดตามหมวด

สัญลักษณ์ในคอลัมน์ "เรา": ✅ มีแล้ว · 🟡 มีบางส่วน · ❌ ไม่พบ

### 1. สินค้า / แค็ตตาล็อก

| ฟีเจอร์ | nopCommerce | Shopify | เรา | ความเห็น |
|---|---|---|---|---|
| สถานะสินค้า | Published + วันเริ่ม/หมดขาย | ใช้งานอยู่ / แบบร่าง / **ไม่ได้ลงรายการ** (เข้าได้ด้วยลิงก์ตรงเท่านั้น) | 🟡 | สถานะ "unlisted" เหมาะกับสินค้าเฉพาะลูกค้าบางราย |
| ตัวเลือกสินค้า / variants | Attribute + Attribute combinations ("Generate all possible combinations"), ราคา/สต็อก/SKU/GTIN ต่อ combination | ตัวเลือก (เช่น ขนาด) → variants | ❌ | เราใช้ pack-price แทน ถ้าจะทำ hub หลายแพลตฟอร์มต้องมี model นี้ |
| ฟิลด์กำหนดเอง | Specification attributes (มีกลุ่ม, ใช้กรองได้, โชว์บนหน้าสินค้า) | **Metafields + Metaobjects** กำหนดได้กับสินค้า, variant, collection, ลูกค้า, ออเดอร์, draft, บริษัท, location, transfer, หน้า, บล็อก, ตลาด | 🟡 ฟิลด์ตายตัวใน `content-fields.ts` | เพิ่มฟิลด์โดยไม่ต้อง migrate ทุกครั้ง (เช่น ใบรับรอง Halal, origin) |
| หมวดหมู่อัตโนมัติ | — | Smart collection: เงื่อนไขจาก tag/ราคา/ประเภท/ผู้ขาย/สต็อก/น้ำหนัก/หมวดหมู่ | ❌ | ใช้ทำหน้าโปรหรือกลุ่ม "สินค้าใหม่/ใกล้หมด" อัตโนมัติ |
| Tier price | ตาราง Tier prices: store, customer role, จำนวน, ราคา, ช่วงวันที่ | ผ่าน Catalog (B2B) | 🟡 entity `price-list` มี `minQty/unitPrice` แต่ไม่มี API | ต่อ API ให้ entity ที่มีอยู่ |
| ราคาเปรียบเทียบ / ต้นทุน | Old price, Product cost | ราคาเปรียบเทียบ, ต้นทุนต่อรายการ, ราคาต่อหน่วย | 🟡 | ต้นทุนใช้คำนวณ margin ในรายงาน (nop มี "Profit" ในหน้าออเดอร์) |
| ข้อจำกัดการซื้อ | Min/Max cart qty, Allowed quantities (เช่น 6,12,24), Required products, Call for price, Disable buy button | กฎการชำระเงิน, ขีดจำกัดการเพิ่มลงตะกร้า | 🟡 | "Allowed quantities" ตรงกับขายเป็นลัง |
| สต็อกต่อสินค้า | Track/ไม่ track/track ตาม attribute, หลายคลัง, Display stock qty, Backorders, Low stock activity, Notify below, Stock quantity history | Track ต่อ location, ขายเมื่อหมดสต็อก, SKU, บาร์โค้ด | 🟡 | ดูข้อ 7 ในตารางสรุป |
| Related / Cross-sell | Related products, Cross-sells, "Purchased with orders" | ผ่านแอป | ❌ | ใช้ข้อมูลออเดอร์ทำ "ซื้อคู่กัน" ได้ |
| SEO | SE name, meta title/keywords/description + หน้ารวม SE names | "รายการบนเครื่องมือค้นหา" + preview | ❌ | |
| AI เขียนคำอธิบาย | Catalog settings → AI: สร้างคำอธิบายสินค้า, meta title/keywords/description พร้อม prompt ที่แก้ได้ | "สร้างข้อความ" (Sidekick) ใน rich text | ❌ | เรามีโครงสร้าง AI อยู่แล้ว ต่อเข้าฟอร์ม product-contents ได้ |
| Bulk edit | หน้า Bulk edit products (Save selected / Save all) | Bulk editor (spreadsheet) | ❌ | |
| Copy product | Copy product (เลือกคัดลอกรูปได้) | ทำสำเนา | ❌ | |
| รีวิวสินค้า | Approve/Disapprove ทีละหลายรายการ, ตอบรีวิว, review types | ผ่านแอป | ❌ | B2B ไม่เร่ง |
| ข้อมูลศุลกากร | — | ประเทศต้นทาง, พิกัด HS (import/export CSV) | ❌ | ไว้ใช้ถ้ามีนำเข้า/ส่งออก |

### 2. ราคา / ส่วนลด / โปรโมชัน

| ฟีเจอร์ | nopCommerce | Shopify | เรา | ความเห็น |
|---|---|---|---|---|
| ประเภทส่วนลด | ส่วนลดที่ order total / สินค้า / หมวดหมู่ / ผู้ผลิต / ค่าส่ง / subtotal | ส่วนลดสินค้า, ส่วนลดออเดอร์, ซื้อ X แถม Y, ส่งฟรี; แบบโค้ดหรืออัตโนมัติ, สุ่มโค้ด | ✅ `/j/promotions-mechanic`, `/j/coupons` | เทียบ checklist ด้านล่าง |
| เงื่อนไขสิทธิ์ | Requirement groups (AND/OR), "ต้องอยู่ใน customer role" | ลูกค้าทุกคน / ตลาด / **กลุ่มลูกค้า (segment)** / ลูกค้าเฉพาะราย | 🟡 audiences | ผูกส่วนลดกับ segment โดยตรง (ปุ่ม "ใช้ส่วนลด" ในหน้า segment) |
| ขั้นต่ำ | — | ยอดซื้อขั้นต่ำ, จำนวนชิ้นขั้นต่ำ | ✅ quantity rules | |
| จำกัดการใช้ | Unlimited / N ครั้ง / N ครั้งต่อลูกค้า, Max discounted qty, Max discount amount | จำกัดจำนวนครั้งทั้งหมด, 1 ครั้งต่อลูกค้า | ? | ตรวจว่า coupon ของเรามี cap ยอดส่วนลดสูงสุดหรือยัง |
| ใช้ร่วมกัน | Cumulative with other discounts | ตั้งได้ว่าใช้ร่วมกับส่วนลดสินค้า / ออเดอร์ / ค่าส่ง | ? | กติกา combine ที่ชัดเจนลดปัญหา "โปรซ้อน" |
| ประวัติการใช้ | แท็บ Usage history (ออเดอร์ที่ใช้, ยอด) + คอลัมน์ Times used | — | ? | ใช้วัดผลโปรรายตัว |
| URL พร้อมโค้ด | "URL with coupon code" | ลิงก์แชร์ส่วนลด | 🟡 smart links | |
| ตั้งเวลาเปลี่ยนแปลงล่วงหน้า | — | **Rollouts**: เตรียมการเปลี่ยนธีม ส่วนลด แค็ตตาล็อก การชำระเงิน แล้วปล่อยตามเวลา / A/B test | 🟡 approval ราคา | ใช้กับ "เปลี่ยนราคาทั้งชุดวันที่ 1" |

### 3. ออเดอร์ / การจัดส่ง / การคืนสินค้า

| ฟีเจอร์ | nopCommerce | Shopify | เรา | ความเห็น |
|---|---|---|---|---|
| สถานะ 3 แกน | Order (Pending/Processing/Complete/Cancelled) × Payment (Pending/Authorized/Paid/Partially refunded/Refunded/Voided) × Shipping (ไม่ต้องส่ง/ยังไม่ส่ง/ส่งบางส่วน/ส่งแล้ว/ถึงแล้ว) | คล้ายกัน (payment / fulfillment) | 🟡 | แยก 3 แกนทำให้ filter ง่าย เช่น "จ่ายแล้วแต่ยังไม่ส่ง" |
| ตัวกรองหน้า list | วันที่, คลัง, สินค้า, 3 สถานะ, store, vendor, เบอร์/อีเมล/นามสกุล/ประเทศที่ออกบิล, วิธีจ่าย, ค้นใน order notes, **ไปที่ออเดอร์ # ตรงๆ** | saved views | 🟡 | |
| Action หลายรายการ | Export, Import, **Print PDF invoices (selected)** | — | 🟡 `/j/batch-sticker` | |
| หน้า detail | แก้ order totals ด้วยมือ, คืนเงิน/คืนบางส่วน, เพิ่มสินค้าเข้าออเดอร์, Add shipment, ดู Profit, Order notes | แก้ไขคำสั่งซื้อ (แจ้งลูกค้าอัตโนมัติ) | 🟡 | "Edit order + แจ้งลูกค้า" ใช้กับเคสของขาด |
| Shipments | Print packaging slips, Set as shipped / ready for pickup / delivered (ทีละหลายรายการ), tracking no., น้ำหนัก, ขนาด | Label การจัดส่ง, บัญชีผู้ขนส่ง, บรรจุภัณฑ์, วันที่ส่งโดยประมาณ, local delivery, รับที่ร้าน, เทมเพลตใบส่งของ | 🟡 `/j/shipments`, entity `shipment` ไม่มี API | |
| Returns | Return request (สถานะ, จำนวนที่คืนเข้าสต็อก), ตั้งเหตุผล/action | คืนสินค้าและยกเลิกด้วยตนเอง + กฎการคืน + store credit | 🟡 `/j/refunds`, credit notes | ให้ลูกค้าขอคืนเองผ่าน portal + กฎ |
| Draft order / Quote | RFQ → Quote (มีวันหมดอายุ) | Draft orders + ส่งใบแจ้งหนี้ | 🟡 | ข้อ 4 ในตารางสรุป |
| ตะกร้าปัจจุบัน | ดูตะกร้า + wishlist ของทุกลูกค้า (สินค้า, จำนวน, ราคา, อัปเดตล่าสุด) | Abandoned checkouts | ❌ | ข้อ 6 |
| Re-order | "Is re-order allowed" | — | ? | B2B สั่งซ้ำบ่อย ถ้า Josh ยังไม่มีควรมี |
| ขั้นต่ำออเดอร์ | Min order sub-total / total | กฎการชำระเงิน | 🟡 | |
| Order number mask | Order number mask, Return request number mask | — | ? | เลขเอกสารตามรูปแบบบริษัท |
| แนบ PDF invoice ในอีเมล | ตอน placed / paid / processing / completed | — | ? | |

### 4. ลูกค้า / B2B / Segment

| ฟีเจอร์ | nopCommerce | Shopify | เรา | ความเห็น |
|---|---|---|---|---|
| Customer roles | Role มีธง Free shipping, Tax exempt, "Purchased with product" (ซื้อสินค้า X แล้วได้ role อัตโนมัติ) | — | 🟡 membership tiers | role อัตโนมัติจากการซื้อ ใช้ทำ tier ได้ |
| Segment editor | — | เขียน query (ShopifyQL-like), template ตั้งต้น 5 ตัว, % ของฐานลูกค้า, ปุ่ม **ใช้ส่วนลด / ส่งออก / ทำสำเนา** | ✅ `/j/segments` + builder | เพิ่ม action จาก segment ไปส่วนลด/campaign ตรงๆ |
| บริษัท (B2B) | Vendors (คนละความหมาย) | Companies + locations + catalog + payment terms + การส่งคำสั่งซื้อ (อัตโนมัติ / draft เพื่อตรวจ) + ภาษี | 🟡 | ข้อ 5 |
| หน้า detail ลูกค้า | แท็บ Orders, Addresses, **ตะกร้า + wishlist ปัจจุบัน**, Activity log, Back in stock subscriptions, Reward points, ส่งอีเมล, Admin comment | หมายเหตุ (ส่วนตัว), แท็ก, ภาษาที่ใช้แจ้งเตือน | 🟡 | รวมทุกอย่างของลูกค้า 1 รายไว้หน้าเดียว (customer 360) |
| Online customers | IP, location, last activity, **last visited page** | Live View | 🟡 `/reports/traffic` | |
| PDPA/GDPR | GDPR settings: เปิด/ปิด, log consent (privacy policy, newsletter), log การแก้โปรไฟล์, ลบลูกค้า inactive หลัง N เดือน, ตั้ง consent หลายข้อ; หน้า GDPR requests log | Privacy: cookie banner, opt-out page, double opt-in, data residency | 🟡 consent check + ลบแบบ PDPA ใน marketing workflow | เพิ่ม consent log + request log (export/ลบ) ให้ครบ |
| Reward points | ตั้ง rate, ขั้นต่ำ/สูงสุดที่ใช้ได้, แต้มจากการซื้อ/สมัคร, วันหมดอายุ | Store credit | ❌ | B2B ใช้ rebate/credit แทนได้ ไม่เร่ง |
| Newsletter | Subscribers + subscription types (หลายรายการ, ติ๊กไว้ล่วงหน้า) + import/export CSV | Email/SMS/WhatsApp opt-in ที่ checkout | 🟡 | แยกประเภทการสมัคร (ข่าวโปร / ราคาใหม่ / สินค้าเข้า) |
| Affiliates | Affiliate + friendly URL + ออเดอร์ที่มาจาก affiliate | — | 🟡 sales rep attribution | ใช้กับ sales rep link ได้ |

### 5. สต็อก / คลัง / จัดซื้อ

| ฟีเจอร์ | nopCommerce | Shopify | เรา | ความเห็น |
|---|---|---|---|---|
| คลัง | Warehouses + ใช้คลังคำนวณค่าส่ง | Locations | ✅ `warehouse` entity | |
| สถานะสต็อก | Stock qty, reserved | มีอยู่ / พร้อมขาย / จัดสรรแล้ว / กำลังนำเข้า / ไม่พร้อมขาย (ตามคลัง) | 🟡 | ข้อ 10 |
| PO | — | Purchase orders | ❌ | |
| Transfer | — | Transfers (ต้นทาง → ปลายทาง, ระหว่างจัดส่ง, ผูกออเดอร์) | 🟡 stock move transfer | |
| สแกนบาร์โค้ด | — | ใน PO และ transfer | ❌ | ต่อกับ warehouse-web |
| ประวัติสต็อก | Stock quantity history ต่อสินค้า | — | ✅ ERP ledger | |

### 6. การตลาด / Growth

| ฟีเจอร์ | nopCommerce | Shopify | เรา | ความเห็น |
|---|---|---|---|---|
| Email campaign | Campaigns (เลือก store, role, ตั้งวันส่ง) | ผ่านแอป Shopify Messaging | ✅ marketing workflow, push | |
| Attribution | — | Attribution report: last non-direct, last click, first click, any click, linear; กรอบเวลา 30 วัน; ยอดขาย/AOV/ลูกค้าใหม่ vs ลูกค้าเก่า ตามช่องทาง | 🟡 smart links, traffic | เพิ่มการเลือกโมเดล attribution ในรายงาน growth |
| Campaign Autopilot | — | ตั้ง ROAS/CAC เป้าหมาย, สิทธิ์ (ถามก่อนรัน / รันได้เลย), ต่อ Meta Ads, Shop Campaigns, Messaging | 🟡 growth plans + AI analyst | รูปแบบ "ถามก่อนรัน / รันได้เลย" ใช้กับ AI ของเราได้ |
| Campaign tracking | — | รวมแคมเปญไว้ที่เดียว วัดผลต่อเป้าหมาย | ✅ `/marketing/growth` | |

### 7. เนื้อหา (CMS)

nopCommerce มี Topics (หน้า, ตั้งรหัสผ่านได้, ช่วงวันที่, รวมใน sitemap), Menus, News, Blog, Polls, Forums, Templates และ Shopify มี Metaobjects, Files, Menus (+ URL redirects), Blog posts

- **เรา:** มีแค่ `/j/promotion-pages`
- **แนะนำ:** ยังไม่ทำ ถ้า storefront ต้องการจริงค่อยทำ CMS แบบเบา (หน้า + เมนู + redirect) ส่วน forum, poll, news ไม่จำเป็น

### 8. รายงาน / Analytics

| รายงาน | nopCommerce | Shopify | เรา |
|---|---|---|---|
| Sales summary แบบ group by วัน/สัปดาห์/เดือน + กรองตามหมวดหมู่/ผู้ผลิต/สินค้า + กำไร, ค่าส่ง, ภาษี | ✅ | ✅ | 🟡 `/reports/sales` |
| Bestsellers (จำนวน, ยอด excl. tax) | ✅ | ✅ | 🟡 bestsellers cron |
| **Products never purchased** ในช่วงเวลา | ✅ | — | ❌ ใช้หาสินค้าค้างสต็อก/ควรเลิกขาย |
| Low stock | ✅ | — | 🟡 |
| ลูกค้าเรียงตามยอด / จำนวนออเดอร์ | ✅ | ✅ | 🟡 winback |
| ยอดขายตามพื้นที่ | ✅ ตามประเทศ | ✅ ตาม location | ❓ ควรทำตามจังหวัด/โซนส่ง |
| ผู้ลงทะเบียนใหม่ตามช่วงเวลา | ✅ | ✅ | 🟡 |
| Dashboard: ออเดอร์ค้างจ่าย, ค้างส่ง, ค้างดำเนินการ (ยอด + จำนวน + ลิงก์ไป list) | ✅ | — | 🟡 `/today` | 
| การเงิน: กำไรขั้นต้นตามออเดอร์, ต้นทุนขาย, ส่วนลดตามออเดอร์, การคืน, payout ตาม gateway | — | ✅ ~50 รายงานในตัว | 🟡 `/analysis/financial/*` |
| Report builder (exploration) + เป้าหมาย (goals) + เปรียบเทียบกับปีก่อน + live view | — | ✅ | 🟡 profit goals |

### 9. ระบบ / ตั้งค่า / ทีมงาน

| ฟีเจอร์ | nopCommerce | Shopify | เรา | ความเห็น |
|---|---|---|---|---|
| สิทธิ์ | ACL matrix: หมวดสิทธิ์ × permission × customer role (แก้ได้ใน UI) | ผู้ใช้ + บทบาท (เจ้าของ, พนักงาน, สิทธิ์จำกัด, สิทธิ์ทั้งหมด), import/export ผู้ใช้, บังคับ login ปลอดภัย | 🟡 role ตายตัวใน `navigation.ts` | ยังไม่ต้องทำ matrix เต็ม แต่ถ้า role เพิ่มบ่อยควรย้ายไปเก็บใน DB |
| MFA / External auth | มี plugin MFA + external login | Secure login | ? | ควรเปิด MFA สำหรับ admin |
| Activity log | ✅ + ตั้งได้ว่า log ประเภทไหน | ✅ | 🟡 ไม่มีหน้าดู | ข้อ 1 |
| System log | Log (level, message, ลบ/ล้าง) | — | ✅ API logs, ERP logs | |
| Message queue | ดูอีเมลในคิว: สถานะส่ง, จำนวนครั้งที่ลอง, **Requeue selected** | — | 🟡 notification log | เพิ่มปุ่มส่งซ้ำ |
| Message templates | Token ที่ใช้ได้, BCC, เลือก email account, **Test template**, ส่งทันที/หน่วงเวลา, แนบไฟล์, Copy template | อีเมลลูกค้า ~30 ประเภท (ยืนยันออเดอร์, ใบแจ้งหนี้ draft, ยืนยันส่ง, รับที่ร้าน, local delivery, แก้ออเดอร์, ยกเลิก, คืนเงิน, **เตือนชำระเงินตามวันครบกำหนด**, payment error) + แจ้งพนักงาน + webhooks | 🟡 notify templates | "เตือนชำระเงินตามวันครบกำหนด" ตรงกับเครดิตเทอม |
| Scheduled tasks | ✅ + Run now | — | 🟡 | ข้อ 2 |
| Maintenance | ลบ guest/ตะกร้าค้าง/ไฟล์ export เก่า, re-index, backup | — | — | ไม่ต้อง |
| Settings ทั่วไป | All settings (key/value, แยก store) | — | 🟡 `core/settings` ไม่มี UI | หน้า key/value ง่ายๆ สำหรับ admin |
| Multi-store / Markets | Stores (URL, ภาษา, ข้อมูลบริษัท, SEO) + "Limited to stores" บนทุก entity | Markets: ภูมิภาค + สกุลเงิน + catalog + การจัดส่ง | 🟡 `organizationId` | แนวคิด "ตลาด/ช่องทาง" ใช้กับ hub หลายแพลตฟอร์ม |
| ภาษี | Tax categories, provider, prices include tax, VAT | ภาษีตามภูมิภาค, ภาษีนำเข้า | ❌ | ราคา THB รวม VAT อยู่แล้ว ถ้ามีสินค้ายกเว้น VAT ค่อยทำ tax category |
| การจัดส่ง | Providers, pickup points, delivery dates, measures, ฟรีค่าส่งเมื่อยอดเกิน X | Shipping profiles, local delivery, pickup, packages, carrier accounts | 🟡 delivery schedule | |
| Plugins | Local plugins + Official feed | Apps | ✅ integrations/connectors | |
| Customer events | — | Pixels (custom + app) | ✅ GTM | |

---

## Pattern ที่ควรยกมาใช้ทั้งระบบ

1. **Save + "Save and Continue Edit"** (nop) และ **แถบ "การเปลี่ยนแปลงที่ยังไม่ได้บันทึก"** (Shopify) ช่วยกันกดออกจากหน้าโดยไม่ได้บันทึก
2. **ช่อง "ไปที่ออเดอร์ # / SKU ตรงๆ"** บนหน้า list (nop) แทนการค้นแล้วคลิก
3. **Bulk action** ที่ทำให้หลายรายการในครั้งเดียว: approve/disapprove, print invoice/packing slip, set shipped/delivered, publish/unpublish
4. **Export / Import บนทุกหน้า list** เป็นปุ่มมาตรฐาน
5. **Tags บนทุก entity** (Shopify ใส่แท็กได้ที่ออเดอร์, ลูกค้า, PO, transfer, ส่วนลด, draft) แล้วใช้ tag เป็นตัวกรองใน saved view และ segment
6. **Admin comment / หมายเหตุภายใน** บน entity หลัก (nop มีทุกตัว, Shopify บอกชัดว่า "ไม่แชร์กับลูกค้า")
7. **"Limited to customer roles / stores"** บนสินค้า หมวดหมู่ หน้า และเมนู (nop) ใช้ซ่อนสินค้าเฉพาะกลุ่มลูกค้า B2B
8. **ปุ่ม "ทดสอบ"** บน template และ config ต่างๆ (Test template ของ nop) ซึ่งเราทำแล้วกับ push เลยใช้ต่อกับอีเมลได้
9. **สิทธิ์ AI แบบ "ถามก่อนรัน / รันได้เลย"** (Shopify Autopilot) ใช้กับ agent/MCP ที่เขียนข้อมูล

---

## ไม่แนะนำ (ไม่ตรงธุรกิจ B2B ขายส่งอาหาร)

Forums, Polls, News, Blog comments, Rental product, Recurring payments, Downloadable product, Gift card, Age verification, Filter YMM (ใช้กับอะไหล่รถ), ธีม/หน้าร้าน, PayPal/Zettle POS, CAPTCHA/robots/sitemap settings (เป็นเรื่องหน้าร้าน), Tipping, ภาษีนำเข้า/DDP

---

## ภาคผนวก: หน้าที่เปิดดู

**nopCommerce (121 หน้า)**
- **Catalog:** Products (list, create, edit, bulk edit), Categories (list, edit), Manufacturers (list, edit), Product reviews (list, edit), Product tags, Product attributes, Specification attributes, Checkout attributes
- **Sales:** Orders (list, edit), Shipments (list, detail), Return requests, Recurring payments, Gift cards, Shopping carts & wishlists, Requests for quote, Quotes
- **Customers:** Customers (list, create, edit), Customer roles (list, edit), Online customers, Vendors (list, edit), Activity log, Activity types, GDPR log
- **Promotions:** Discounts (list, create, edit), Affiliates (list, edit), Newsletter subscribers, Subscription types, Campaigns
- **Content:** Topics, Menus, Message templates, News, News comments, Blog posts, Blog comments, Polls, Forums
- **Settings (15 หน้า):** General, Customer, Order, Shipping, Tax, Catalog, Filter, Shopping cart, Reward points, GDPR, Vendor, Blog, News, Forum, Media, All settings
- **Configuration:** Email accounts, Stores, Countries, Languages, Currencies, Payment methods/restrictions, Tax providers/categories, Shipping providers, Warehouses, Pickup points, Dates & ranges, Measures, ACL, Widgets, External auth, MFA, Plugins
- **System:** System info, Log, Warnings, Maintenance, Message queue, Schedule tasks, SE names, Templates
- **Reports:** Sales summary, Low stock, Bestsellers, Never purchased, Country sales, Registered customers, Customers by order total, Customers by number of orders

**Shopify (~40 หน้า)**
- **หน้าหลัก:** Home (onboarding)
- **ออเดอร์:** Orders, Draft order (new), Abandoned checkouts (ล็อกตามแผน)
- **สินค้า:** Products (list, new), Collections (new, smart rules), Inventory, Purchase order (new), Transfer (new), Gift card (new)
- **ลูกค้า:** Customers (new), Segments (list, new), Companies (new)
- **Growth:** Overview, Attribution, Autopilot, Campaigns, Discounts (new)
- **Content:** Metaobjects, Menus
- **ตลาด:** Markets, Catalogs, Rollouts
- **Analytics:** Dashboard, Reports (list ~50)
- **Settings:** General, Users, Checkout, Customer accounts, Shipping, Taxes, Notifications (+ customer notifications), Metafields & metaobjects, Customer privacy, Store activity log, Customer events
