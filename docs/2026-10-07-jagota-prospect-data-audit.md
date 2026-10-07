# JAGOTA: ตรวจข้อมูลสำหรับหาร้านอาหารลูกค้าใหม่ในกรุงเทพฯ

ตรวจวันที่ 7 ตุลาคม 2026 เวลาไทย 11:07–11:15 น. จากโค้ด commerce-platform และฐานข้อมูล **local copy** ที่ใช้กับ preview เท่านั้น ไม่ใช่ตัวเลขตลาดกรุงเทพฯ ทั้งหมดหรือฐานลูกค้า JAGOTA production

## ข้อสรุปสำหรับตัดสินใจ

1. ใช้ Market Explorer เป็นฐานคัดร้านและส่งงานให้ฝ่ายขายได้ แต่ข้อมูลปัจจุบันยังเหมาะกับ **รายชื่อที่ต้องตรวจเพิ่ม** มากกว่ารายชื่อที่พร้อมติดต่อ: ไม่มี phone/website/closed status ใน restaurant schema, เขตหาย 80.1%, และไม่มี enrichment ใหม่ใน 30 วัน
2. จัดการ **พื้นที่และตัวตนร้าน** ก่อนเพิ่มคะแนน AI: มี 402 กลุ่ม Google place ID ซ้ำ ครอบคลุม 1,302 แถว; กลุ่มใหญ่สุด 65 แถว จึงไม่ควรนับทุกแถวเป็นคนละสาขาหรือรวมด้วยชื่อ/Google ID อัตโนมัติ
3. เริ่ม segment ตามวัตถุดิบที่ต้องใช้จริง เช่น ญี่ปุ่น/ซูชิ, อิตาเลียน/ฝรั่งเศส/สเต๊ก และคาเฟ่ แล้วให้ฝ่ายขายยืนยันเมนู ผู้ตัดสินใจซื้อ และความเหมาะสมของข้อเสนอ คะแนนรีวิวเป็นเพียงสัญญาณประกอบ
4. ใช้ Winback/contacts/activities/assignment ที่มีอยู่ต่อ ไม่สร้าง CRM ใหม่ แต่ต้องยืนยัน runtime ownership และ mirror ก่อนใช้สถานะ “ยังไม่มีฝ่ายขาย” เป็นตัวตัดสิน
5. **ยังทำ restaurant lookalike จาก local copy นี้ไม่ได้**: มีเพียง 1 บริษัทที่ผ่าน purchase predicate เดิม และไม่มีสะพาน restaurant → company → qualifying purchase เลย ผลนี้บอกข้อจำกัดของ local copy ไม่ได้บอกว่า JAGOTA มีลูกค้าที่ซื้อจริงเพียงรายเดียว

## วิธีตรวจและขอบเขตหลักฐาน

- อ่าน `JOSH_DATABASE_URL` จาก config ของ local preview โดยไม่แสดง credentials; URL ชี้ loopback และ role ที่ระบุไม่มีใน PostgreSQL local (`28000`, role missing)
- จึงอ่าน **ฐาน local เดิม** ด้วย OS database role ที่มีอยู่ และบังคับ `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; ไม่สร้าง role, ไม่เปลี่ยน config และไม่เขียนข้อมูล
- Snapshot ที่ยืนยันได้: `2026-10-07T04:07:51.480Z`, `04:09:37.674Z`, `04:11:07.882Z`, `04:12:02.282Z`, `04:13:27.160Z`, `04:15:08.808Z`; ทุกชุด query อยู่ใน read-only transaction ของตนเอง จึงไม่ใช่ snapshot เดียวครอบคลุมทุกตาราง/ทุกชุด
- `pg_is_in_recovery() = false`: แหล่งที่อ่านเป็น PostgreSQL local copy ไม่ได้ยืนยันว่าเป็น physical read replica หรือ production ที่สดอยู่
- ตรวจ aggregate และ schema; ไม่ dump เบอร์โทร อีเมล บุคคล หรือพิกัดรายร้าน ไม่มีการทดสอบส่งข้อความ/สร้าง lead/import
- `JoshReplica` ใน product ระบุให้ใช้ replica/SELECT-only, `synchronize:false`, `migrationsRun:false` [R1] แต่การตั้งชื่อคลาสนี้ไม่ได้พิสูจน์สถานะฐานที่กำลังอ่าน

## 1. Coverage ของร้าน 7,248 แถว

ตัวเลขต่อไปนี้เป็น `IS NOT NULL`/ค่าที่ไม่ว่างตาม SQL appendix ไม่ใช่การยืนยันความถูกต้องหรือความสดของ field [Q1]

| Field | มีข้อมูล | Coverage | ขาด |
|---|---:|---:|---:|
| ชื่อ | 7,248 | 100% | 0 |
| raw_category | 7,248 | 100% | 0 |
| พิกัดผ่าน range และไม่ใช่ 0,0 | 7,248 | 100% | 0 |
| district | 1,444 | 19.9% | 5,804 |
| rating | 4,158 | 57.4% | 3,090 |
| review_count | 4,159 | 57.4% | 3,089 |
| price_range | 2,631 | 36.3% | 4,617 |
| popular_times | 2,549 | 35.2% | 4,699 |
| opening_hours | 3,726 | 51.4% | 3,522 |
| dine_in | 3,351 | 46.2% | 3,897 |
| takeaway | 2,826 | 39.0% | 4,422 |
| delivery | 2,137 | 29.5% | 5,111 |
| enriched_at | 7,248 | 100% | 0 |

`enriched_at` มีครบแต่ `rating` ยังขาด 42.6% จึงไม่ควรให้ป้าย “enriched” หมายความว่า “ข้อมูลครบ/ติดต่อได้” ค่า boolean ที่ไม่ทราบต้องแสดงเป็นไม่ทราบ ไม่ใช่ไม่มีบริการ

ไม่มีคอลัมน์ phone/email/website/business_status/closed/open_now/branch/company ใน `restaurant_place` จริงที่ตรวจ และไม่มีใน copied entity [R2] ดังนั้น contact/website/ปิดกิจการ/สาขาที่ผ่านการยืนยันคือ **ไม่มี field รองรับ** ไม่ใช่ 0 ร้านมีเบอร์หรือ 0 ร้านปิดกิจการ

### แหล่งข้อมูลและความสด

- ทุกแถว `source='osm'`, มี `osm_id` 7,248, มี Google place ID 4,304, FSQ ID 0
- rating ทั้ง 4,158 แถวและ popular_times ทั้ง 2,549 แถวอยู่ในกลุ่มที่มี Google place ID; กลุ่มไม่มี Google ID ไม่มี rating/popular_times
- ความสัมพันธ์นี้ **สอดคล้องกับการ enrichment ที่เกี่ยวกับ Google แต่ยังไม่พิสูจน์แหล่งกำเนิดราย field**; `source='osm'` ไม่เพียงพอที่จะประกาศว่า rating/reviews/price/popular times ทั้งหมดเป็น OSM หรือ first-party
- `created_at` ทุกแถวอยู่ที่ `2026-08-21T09:49:17.265Z`; `enriched_at` ตั้งแต่ `2026-08-21T09:58:41.773Z` ถึง `2026-08-25T10:05:07.359Z`; `updated_at` อยู่ในช่วงเดียวกับ enrichment
- ทั้ง 7,248 อยู่ในช่วง enrichment 90 วัน แต่ **0 แถวใน 30 วัน** ณ วันที่ตรวจ; ไม่มีวัน enrichment ในอนาคต ไม่พบ import manifest หรือ field-level lineage ใน schema/API ที่ตรวจ จึงไม่ยืนยันวันดึงต้นทางจริงหรือสิทธิการใช้ต่อ [Q1, Q4, R2]
- Entity comment ยังบอกว่า OSM ID “reserved v2” ทั้งที่ local data มี OSM ID ครบ เป็นหลักฐานว่าห้ามใช้ comment แทน audit ข้อมูลจริง [R2:372–374]

### ราคาและเวลาเปิด

price_range เป็นข้อความ ไม่ใช่ min/max ต่อคนที่ normalize แล้ว ตัวอย่างที่พบ: `฿1–200` 1,138, `฿200–400` 879, `฿400–600` 138, `฿2,000+` 41; ยังพบ `$50–100` และ `3-star hotel` ในชุด aggregate จึงไม่ควรแปลงทุกค่าเป็นกำลังซื้อร้านหรือใช้ราคา exact match เป็น premium score [Q1]

opening_hours มี JSON object 3,726 และ null 3,522; keys เป็นวันภาษาอังกฤษและวันพิเศษ เช่น `Tuesday(Mawlid)`, `Thursday(Ghost Festival)` ไม่พบ `open_now`/business closure. “เปิดเวลานี้”, “มีตารางเวลา” และ “ยังดำเนินกิจการ” ต้องเป็นคนละสถานะ และ timezone/holiday parsing ยังไม่มีหลักฐานผ่านการตรวจใน flow นี้

## 2. กรุงเทพฯ, แขวง/เขต และ identity

### พื้นที่

- Exact-match กับ whitelist ชื่อเขตกรุงเทพฯ ภาษาไทย 50 ชื่อใน Q2 พบ **1,138 แถว ครอบคลุม 44 ชื่อเขต**; ไม่ใช่ coverage 44/50 ที่เชื่อถือได้ เพราะ district หายมากและปะปนหลายระดับ
- district ตัวอย่างอันดับต้น: พระนคร 157, บางรัก 155, ปทุมวัน 125, ลาดกระบัง 101, ดินแดง 70, วัฒนา 62, สาทร 60, สัมพันธวงศ์ 60
- มี 75 แถวที่ district เริ่มด้วย `แขวง`, 61 แถวที่มีอักษรอังกฤษ; มี `กรุงเทพมหานคร`, `Phayathai`, `Pathum Wan`, `แขวงคลองจั่น` และพื้นที่นอกกรุงเทพฯ เช่น ลำลูกกา/บางพลี/เมืองนนทบุรี ปะปน
- Bbox หยาบ lat 13.49–14.00/lng 100.32–100.95 ให้ 6,732 แถว แต่ 5,355 แถวในกรอบนี้ไม่มี district; กรอบนี้ครอบคลุมพื้นที่ข้างเคียงและ **ไม่ใช่เส้นเขตปกครองกรุงเทพฯ** ใช้บอก missingness เท่านั้น
- Filter ปัจจุบัน `district = parameter` เป็น exact match; ไม่ normalize ย่าน/แขวง/เขต และไม่มี province/subdistrict hierarchy [R3:56–63]

สิ่งควรเพิ่มก่อน territory scoring: เก็บ `province/district/subdistrict` แบบรหัสมาตรฐาน, preserve raw address, ระบุวิธีและความมั่นใจของ geocoding, และใช้ polygon พื้นที่ส่งของจริงของ JAGOTA. “สุขุมวิท/ทองหล่อ/อารีย์” เป็นย่านสำหรับฝ่ายขาย ไม่ควรใส่ทับ field เขต

### ร้านซ้ำและสาขา

| ตัวชี้วัด | ผล |
|---|---:|
| OSM ID ซ้ำ | 0 กลุ่ม |
| Google IDs ที่แตกต่างกัน | 3,404 จาก 4,304 แถวที่มี ID |
| Google ID ซ้ำ | 402 กลุ่ม / 1,302 แถว |
| กลุ่ม Google ID ใหญ่สุด | 65 แถว |
| ชื่อหลัง lower/trim ซ้ำ | 349 กลุ่ม |
| พิกัด lat/lng เดียวกัน | 2 กลุ่ม |

นี่เป็น **candidate duplication** ไม่ใช่คำตัดสินว่าร้านซ้ำ 1,302 แถวทั้งหมด อาจเป็น OSM features หลายจุด สาขา หรือ enrichment match ผิด ต้องตรวจชื่อ ที่อยู่ source IDs และ branch relationship ก่อน merge; ชื่อซ้ำอาจเป็นแบรนด์คนละสาขา ขณะที่ชื่อไม่ซ้ำก็อาจเป็นร้านเดียวกัน ไม่มี verified chain/branch key ใน restaurant schema [Q4, R2]

## 3. Segment สำหรับทดลอง acquisition

Predicate เป็น hypothesis จาก raw_category เพื่อเริ่มตรวจ ไม่ใช่การรับรองว่าใช้วัตถุดิบ premium หรือยังไม่ซื้อจาก JAGOTA ตัวเลข “เขต กทม.” เป็น exact-match whitelist เท่านั้น; “ทั้งหมด” รวมพื้นที่นอกกรุงเทพฯ และพื้นที่ที่ไม่ทราบ [Q2]

| กลุ่ม | ทั้งหมด | เขต กทม. ที่รู้ชื่อ | ขาดเขต | ขาด rating | ขาด reviews | ขาดราคา | rating≥4 & reviews≥50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Japanese / sushi (`japanese\|sushi`) | 323 | 36 | 280 | 107 | 107 | 157 | 163 |
| Western specific (`italian\|french\|steak\|european\|spanish`) | 227 | 40 | 168 | 135 | 135 | 166 | 67 |
| cafe* | 2,186 | 298 | 1,771 | 832 | 832 | 1,415 | 707 |
| seafood | 84 | 20 | 54 | 51 | 51 | 59 | 26 |
| rating≥4 & reviews≥50 | 2,514 | 387 | 2,085 | 0 | 0 | 532 | 2,514 |
| กลุ่มข้างบนที่ยังไม่ link Winback | 2,513 | 387 | 2,084 | 0 | 0 | 531 | 2,513 |

กลุ่ม overlap กันได้ เช่น cafe:japanese อยู่ทั้ง cafe และ Japanese. ฟิลเตอร์ threshold ตัดร้านข้อมูลหายทิ้งทันที จึงควรมีคิว “น่าสนใจแต่ข้อมูลไม่ครบ” แยกจากคิว “พร้อมตรวจเสนอสินค้า”; reviews มากไม่เท่ากับยอดซื้อวัตถุดิบ และ `estimatedTables` เป็น sqrt(reviewCount) heuristic ไม่ใช่โต๊ะที่สำรวจ [R3:89–91]

### ตัวอย่างชื่อสาธารณะจาก local copy

| ชื่อที่เก็บ | category ที่เก็บ | website ที่เก็บ | ใช้ทำอะไรต่อได้ |
|---|---|---|---|
| Peppina | restaurant:italian | ไม่มี field นี้ | ตรวจตัวตน/สาขาและเมนูก่อนสร้างสมมติฐานกลุ่มแป้ง ชีส หรือ cured meat |
| ปอล / Paul | cafe:patisserie | ไม่มี field นี้ | ตรวจว่าเป็นแบรนด์/สาขาใด ก่อนสมมติกลุ่ม bakery/patisserie |
| Goji Kitchen | restaurant | ไม่มี field นี้ | category ยังทั่วไป ต้องตรวจ menu/concept ก่อนเสนอสินค้า |

ยังไม่ยืนยันการจับคู่กับเว็บไซต์ปัจจุบัน สถานะเปิดหรือการเป็นลูกค้าใหม่. Query `zuma` เจอ `Azuma` ไม่ใช่หลักฐานพบ Zuma จึงไม่รวมเป็นตัวอย่าง Zuma [Q5]

## 4. Buyer/category/restaurant joins: ทำ lookalike ได้แค่ไหน

### Key ที่ใช้ได้ และสิ่งที่ไม่ควรปะปน

| ความสัมพันธ์ | Key | ความหมาย/ความเชื่อถือ |
|---|---|---|
| Josh order → company/branch/user | orders.company_id / branch_id / user_id → PK | persisted IDs; ใช้เป็น buyer identity ได้ในขอบเขต Josh |
| Order → purchased SKU/category | orders.orders_id → order_items.order_id → product_inventory_id → product_inventory.category_id | strong line-item join; category เป็น taxonomy สินค้า ไม่ใช่ cuisine ร้าน |
| Restaurant → sales account | restaurant_place.id → winback_account.restaurant_place_id | แปลว่าอยู่ใน sales workspace ไม่ได้แปลว่าเคยซื้อ |
| Sales account → Josh company/user | winback_account.josh_company_id / josh_user_id | ถ้า key มีและ valid สามารถ bridge ต่อได้ แต่ต้องทราบ origin/วิธี match |
| ERP customer → Josh company | erp_sales_history.cust_code ↔ company.erp_customer_code | คนละ code space กับ orders.customer_code; ต้องตรวจ uniqueness และ branch mapping ก่อน join |

อ้างอิง [R4:97–114], [R5:95–106], [R6:24–33], [R7:24–47], [R2:418–426]. ไม่ใช้ชื่อร้าน/company name เป็น automatic identity. ERP code อาจแชร์หลาย company ในระบบจริง ต้องตรวจ cardinality ของ source เป้าหมายทุกครั้ง; local copy นี้มี code ที่ไม่ว่างเพียง 3 ค่า จึงไม่พิสูจน์ uniqueness ของ production

### สิ่งที่พบจริงใน local copy

- company 4,428 แต่มี ERP code 3 บริษัท/3 distinct codes; phone มี 13; business_type non-null ทุกแถวไม่ใช่หลักฐานว่าผ่าน qualification ร้าน
- users 30, branches 21, orders 1,639, order_items 3,226, products 5,889, product categories 239
- products มี category 5,888 และ brand_name 5,888 แต่ ingredients/allergens 0; จึงทำ product/category basket ได้ แต่ใช้ ingredient/allergen attributes จาก local catalog นี้ไม่ได้
- orders มี status paid 1,219 + preparing 202 + shipped 107 + delivered 42 = 1,570; **ห้ามนับทั้ง 1,570 เป็น paid buyers** โดยไม่ตรวจ payment
- Predicate เดิมของระบบต้องเป็น status paid/preparing/shipped/delivered **และ** มี payment success ที่ไม่ใช่ test ผ่าน direct order หรือ checkout-batch link [R8:7–16]
- ตาม predicate นี้พบ **14 orders, 1 company, 2 users, 3 branches**, ช่วง order 23 มิ.ย.–10 ก.ค. 2026; 24 product lines เชื่อม product/category ได้ครบ เป็น 13 SKUs / 7 categories
- Predicate นี้รวม credit-term checkout ที่บันทึก success จึงเป็น purchase qualification ตาม contract เดิม **ไม่ได้พิสูจน์ว่าเก็บเงิน invoice แล้ว** [R8:10–12]
- Josh-copy Winback 15 accounts มี restaurant links 2 (valid ทั้ง 2), josh_company_id 1 และ josh_user_id 1 แต่ **restaurant-company bridge 0 / qualifying purchased restaurant 0**
- `erp_sales_history` และ `segment_customers` ไม่มี relation ใน local copy ที่ตรวจ ไม่สามารถนับ Jagota ERP buyer baseline หรือ segment coverage production
- Local `commerce_db` แยกต่างหากมี Winback account/contact/activity **0/0/0**; products 440, customers 174. ตัวเลขนี้คนละฐาน/owner กับ Josh-copy และไม่ควรรวมเป็นตลาดเดียวกัน

**ผลต่อ lookalike:** มีโครงสร้างรองรับ buyer→SKU/category ที่ชัด แต่หลักฐาน local มี buyer company เดียวและไม่มี restaurant bridge จึงยัง calibrate cuisine/พื้นที่/premium-fit จากลูกค้าร้านเดิมไม่ได้ ต้องได้ approved ERP sales-line customer+SKU snapshot, customer/branch identity, ร้านที่ match แล้วพร้อม provenance และข้อมูล outcome ก่อนใช้เป็น training/validation baseline [Q3]

## 5. Feature ที่ใช้ซ้ำและลำดับทำงาน

| ลำดับ | ทำอะไร | ของเดิมที่ใช้ซ้ำ / จุดที่ขาด |
|---|---|---|
| P0 | แสดง source/วันตรวจ/coverage/unknown และตรวจร้านซ้ำ | source/enriched_at มีอยู่; ขาด field lineage, verified venue/branch และ closure/contact |
| P0 | Normalize เขต/แขวง/ย่าน และคัดตามพื้นที่ส่งจริง | พิกัดมีครบ; exact district filter เดิมไม่ครอบคลุมข้อมูลที่หาย/ปะปน |
| P1 | บันทึก shortlist → ตรวจคนซื้อ/เมนู → owner/follow-up | createTmpFromRestaurantPlace, Winback contacts/activities/assignment มีแล้ว; create TMP ตั้ง phone=null จึงต้องเก็บ contact เพิ่ม [R9] |
| P1 | เตรียมข้อเสนอ SKU ตาม ingredient-fit ที่คนขายตรวจ | catalog/SKU/category/stock/MOQ/pricing/order lines มีแล้ว; ยังไม่มี restaurant-cuisine→ingredient/SKU taxonomy ที่ผ่านการตรวจ [R6, R10] |
| P1 | วัดพบผู้ซื้อ/ได้รับอนุญาตติดต่อ/นัด sample/first order/reorder | ใช้ activity/stage/notes เดิม แล้วเชื่อม order ผ่าน persisted identity; listed account ไม่ใช่ conversion [R7, R11] |
| P2 | Restaurant lookalike/automated scoring | เพิ่มหลังได้ buyer-label coverage และ restaurant bridge ที่ตรวจแล้ว; อย่าใช้ rating/โต๊ะประมาณเป็น proxy ของ spend |

Marketing segments เดิมอิง Josh users/segment_customers และ workflow enrollment/sending ยังอยู่ Josh เหมาะกับ onboarding/reorder หลังเชื่อมลูกค้า ไม่ใช่การส่ง cold outreach ถึงร้านทั้งหมดใน explorer [R12]

### Ownership/mirror ที่ต้องพิสูจน์ก่อนใช้ในงานขายจริง

Active Winback services ใช้ commerce tables แต่ restaurant links/exclusion ใน explorer อ่าน `winback_account` ของ Josh copy/replica [R3:69,80–86; R13]. มี mirror commerce→Josh ที่ตั้งใจรองรับ flow นี้ แต่ cron opt-in และ cadence default ทุก 5 นาที แล้วยังมี outbox/replica lag; owner default เป็น Josh และ local writes เปิดเมื่อ `WINBACK_OWNER=commerce` [R14]. การตรวจครั้งนี้ไม่ได้ยืนยัน runtime owner หรือ mirror health จึงให้ความหมาย “ยังไม่ link ในสำเนาที่อ่าน” แทน “ยังไม่เคยเป็นลูกค้า JAGOTA”

## แหล่งโค้ด

- **R1** `apps/commerce-platform/src/modules/integration/connector/josh/josh-replica.ts:7–24` — replica contract/ไม่ migrate
- **R2** `apps/commerce-platform/src/modules/integration/winback/josh-replica-tables.ts:340–415,418–449` — restaurant schema/provenance และ ERP customer code space
- **R3** `apps/commerce-platform/src/modules/integration/connector/josh/restaurant-places.ts:11–19,53–100,120–170` — filters/list/link/export/detail/estimated tables
- **R4** `apps/commerce-platform/src/modules/integration/connector/josh/josh-orders.ts:97–128` — company/branch/user/item joins
- **R5** `apps/commerce-platform/src/modules/integration/connector/josh/josh-customers.ts:44–47,79–107` — customer/ERP identity และ masked contacts
- **R6** `apps/commerce-platform/src/modules/integration/connector/josh/josh-products.ts:24–55,79–112` — catalog fields/taxonomy
- **R7** `apps/commerce-platform/src/modules/integration/winback/entities/winback-account.entity.ts:24–47,95–123,146–222` — identity/owner/contact/cuisine/business/restaurant link
- **R8** `apps/commerce-platform/src/modules/integration/connector/josh/josh-insights.ts:7–16` และ `josh-orders.ts:7–8,68–76` — qualifying purchase predicate
- **R9** `apps/commerce-platform/src/modules/integration/winback/lead.service.ts:225–281` — create TMP from place และ contact ที่ปล่อยว่าง
- **R10** `apps/commerce-platform/src/modules/integration/connector/josh/josh-prices.ts:43–58,81–138` — customer/branch/contract prices; promotions ต้องคำนวณจริงใน Josh
- **R11** `apps/commerce-platform/src/modules/integration/winback/entities/winback-contact.entity.ts:9–31`, `winback-activity.entity.ts:17–61` — contacts และ sales outcome
- **R12** `apps/commerce-platform/src/modules/integration/segments/segment-base.ts:3–16`, `segment-fields.ts:32–168`, `growth/growth.service.ts:151–184`, `connector/josh/josh-marketing-workflows.ts:4–7`
- **R13** `apps/commerce-platform/src/modules/integration/winback/winback.module.ts:49–74,87–115` — local Winback / replica source providers
- **R14** `apps/commerce-platform/src/modules/integration/winback/winback-mirror.ts:16,28–37,51–79`, `shared/winback.config.ts:13–16` — mirror opt-in/cadence/owner

## SQL appendix: aggregate แบบ read-only ที่ทำซ้ำได้

รันกับ approved local copy/SELECT-only replica โดยส่ง credentials ผ่าน secret/config ปกติ ไม่วาง DSN ในเอกสารนี้ ทุก query ด้านล่างเป็น SELECT; ห้ามใช้ผล local แทน production-wide counts. Q1–Q5 ใช้ Josh-copy; query commerce-local แยกฐาน. ผลคนละเวลาต้องระบุ snapshot ใหม่

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT now() AS captured_at, pg_is_in_recovery() AS physical_replica,
       current_setting('transaction_read_only') AS read_only;

-- Q1: schema/coverage/provenance/freshness. COUNT(field) คือ non-null เท่านั้น
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='restaurant_place' ORDER BY ordinal_position;
SELECT count(*) AS total, count(district) AS district_known,
       count(raw_category) AS category_known, count(rating) AS rating_known,
       count(review_count) AS reviews_known, count(price_range) AS price_known,
       count(popular_times) AS popular_known, count(opening_hours) AS opening_known,
       count(dine_in) AS dine_in_known, count(takeaway) AS takeaway_known,
       count(delivery) AS delivery_known, count(enriched_at) AS enriched,
       count(*) FILTER(WHERE lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
                         AND (lat<>0 OR lng<>0)) AS valid_coordinates,
       min(created_at), max(created_at), min(updated_at), max(updated_at),
       min(enriched_at), max(enriched_at),
       count(*) FILTER(WHERE enriched_at >= now()-interval '30 days') AS enriched_30d,
       count(*) FILTER(WHERE enriched_at >= now()-interval '90 days') AS enriched_90d
  FROM restaurant_place;
SELECT source,count(*) AS n,count(osm_id),count(google_place_id),count(fsq_id)
  FROM restaurant_place GROUP BY source;
SELECT district,count(*) AS n FROM restaurant_place GROUP BY district ORDER BY n DESC;
SELECT raw_category,count(*) AS n FROM restaurant_place GROUP BY raw_category ORDER BY n DESC;
SELECT price_range,count(*) AS n FROM restaurant_place GROUP BY price_range ORDER BY n DESC;

-- Q2: whitelist สำหรับ audit เป็น exact-match proxy ไม่ใช่ spatial boundary
WITH bkk AS (SELECT ARRAY[
 'พระนคร','ดุสิต','หนองจอก','บางรัก','บางเขน','บางกะปิ','ปทุมวัน','ป้อมปราบศัตรูพ่าย',
 'พระโขนง','มีนบุรี','ลาดกระบัง','ยานนาวา','สัมพันธวงศ์','พญาไท','ธนบุรี','บางกอกใหญ่',
 'ห้วยขวาง','คลองสาน','ตลิ่งชัน','บางกอกน้อย','บางขุนเทียน','ภาษีเจริญ','หนองแขม',
 'ราษฎร์บูรณะ','บางพลัด','ดินแดง','บึงกุ่ม','สาทร','บางซื่อ','จตุจักร','บางคอแหลม',
 'ประเวศ','คลองเตย','สวนหลวง','จอมทอง','ดอนเมือง','ราชเทวี','ลาดพร้าว','วัฒนา','บางแค',
 'หลักสี่','สายไหม','คันนายาว','สะพานสูง','วังทองหลาง','คลองสามวา','บางนา','ทวีวัฒนา',
 'ทุ่งครุ','บางบอน']::text[] AS names),
p AS (SELECT r.*, district=ANY(b.names) AS known_bkk,
             NOT EXISTS(SELECT 1 FROM winback_account wa WHERE wa.restaurant_place_id=r.id) AS unlinked
        FROM restaurant_place r CROSS JOIN bkk b)
SELECT s.segment,count(*) AS n,count(*) FILTER(WHERE p.known_bkk) AS known_bkk,
       count(*) FILTER(WHERE district IS NULL) AS missing_district,
       count(*) FILTER(WHERE rating IS NULL) AS missing_rating,
       count(*) FILTER(WHERE review_count IS NULL) AS missing_reviews,
       count(*) FILTER(WHERE price_range IS NULL) AS missing_price,
       count(*) FILTER(WHERE rating>=4 AND review_count>=50) AS rating4_reviews50
FROM p CROSS JOIN LATERAL (VALUES
 ('all',true),('japanese_sushi',raw_category ~ '(japanese|sushi)'),
 ('western_specific',raw_category ~ '(italian|french|steak|european|spanish)'),
 ('cafes',raw_category LIKE 'cafe%'),('seafood',raw_category LIKE '%seafood%'),
 ('rating4_reviews50',rating>=4 AND review_count>=50),
 ('rating4_reviews50_unlinked',rating>=4 AND review_count>=50 AND unlinked)
) s(segment, matches) WHERE s.matches GROUP BY s.segment ORDER BY s.segment;
SELECT count(*) FILTER(WHERE lat BETWEEN 13.49 AND 14.00 AND lng BETWEEN 100.32 AND 100.95) AS rough_bbox,
       count(*) FILTER(WHERE district IS NULL AND lat BETWEEN 13.49 AND 14.00 AND lng BETWEEN 100.32 AND 100.95) AS bbox_missing_district,
       count(*) FILTER(WHERE district LIKE 'แขวง%') AS subdistrict_prefix,
       count(*) FILTER(WHERE district ~ '[A-Za-z]') AS english_district FROM restaurant_place;

-- Q3: buyer/SKU/category/restaurant bridge ตาม purchase contract เดิม
WITH paid AS (
 SELECT o.* FROM orders o WHERE o.status::text IN ('paid','preparing','shipped','delivered') AND (
  EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_id=o.orders_id
          AND pt.status::text='success' AND NOT pt.is_test)
  OR EXISTS(SELECT 1 FROM payment_transaction_orders po JOIN payment_transactions pt ON pt.id=po.transaction_id
             WHERE po.order_id=o.orders_id AND pt.status::text='success' AND NOT pt.is_test))),
lines AS (SELECT o.company_id,pi.product_inventory_sku,pc.id AS category_id
 FROM paid o JOIN order_items oi ON oi.order_id=o.orders_id
 LEFT JOIN product_inventory pi ON pi.product_inventory_id=oi.product_inventory_id
 LEFT JOIN product_category pc ON pc.id=pi.category_id)
SELECT (SELECT count(*) FROM paid) AS qualified_orders,
 (SELECT count(DISTINCT company_id) FROM paid) AS buyer_companies,
 (SELECT min(create_date) FROM paid) AS first_order,(SELECT max(create_date) FROM paid) AS latest_order,
 (SELECT count(*) FROM lines) AS lines,
 (SELECT count(product_inventory_sku) FROM lines) AS valid_sku_lines,
 (SELECT count(category_id) FROM lines) AS valid_category_lines,
 (SELECT count(DISTINCT product_inventory_sku) FROM lines) AS skus,
 (SELECT count(DISTINCT category_id) FROM lines) AS categories,
 (SELECT count(DISTINCT wa.restaurant_place_id) FROM paid o
   JOIN winback_account wa ON wa.josh_company_id=o.company_id
   JOIN restaurant_place r ON r.id=wa.restaurant_place_id) AS purchased_restaurants;
SELECT count(*) AS accounts,count(restaurant_place_id),count(josh_company_id),count(josh_user_id),
       count(cuisine_id),count(cuisine_name),count(business_size),count(phone),count(email),count(line_id),
       count(consent_at),count(assigned_sales_user_id) FROM winback_account;
SELECT count(*) AS restaurant_links,count(r.id) AS valid_restaurant,count(c.id) AS company_bridges
 FROM winback_account wa LEFT JOIN restaurant_place r ON r.id=wa.restaurant_place_id
 LEFT JOIN company c ON c.id=wa.josh_company_id WHERE wa.restaurant_place_id IS NOT NULL;
SELECT count(*) AS companies,count(NULLIF(erp_customer_code,'')) AS erp_known,
       count(DISTINCT NULLIF(erp_customer_code,'')) AS distinct_erp_codes FROM company;
SELECT to_regclass('public.erp_sales_history'),to_regclass('public.segment_customers');

-- Q4: candidate duplicates และ source overlap; ไม่ merge จากผลนี้
WITH g AS (SELECT google_place_id,count(*) AS n FROM restaurant_place
 WHERE google_place_id IS NOT NULL GROUP BY google_place_id)
SELECT count(*) AS distinct_google_ids,count(*) FILTER(WHERE n>1) AS duplicate_groups,
       sum(n) FILTER(WHERE n>1) AS affected_rows,max(n) AS biggest_group FROM g;
SELECT count(*) AS repeated_osm_groups FROM (SELECT osm_id FROM restaurant_place
 WHERE osm_id IS NOT NULL GROUP BY osm_id HAVING count(*)>1) d;
SELECT count(*) AS repeated_name_groups FROM (SELECT lower(trim(coalesce(name_th,name_en,'')))
 FROM restaurant_place GROUP BY 1 HAVING count(*)>1) d;
SELECT count(*) AS shared_coordinate_groups FROM (SELECT lat,lng FROM restaurant_place
 GROUP BY lat,lng HAVING count(*)>1) d;
SELECT DISTINCT jsonb_object_keys(opening_hours) AS key FROM restaurant_place
 WHERE jsonb_typeof(opening_hours)='object';
SELECT count(*) FILTER(WHERE google_place_id IS NULL AND rating IS NOT NULL) AS rating_without_google_id,
       count(*) FILTER(WHERE google_place_id IS NOT NULL AND rating IS NOT NULL) AS rating_with_google_id,
       count(*) FILTER(WHERE google_place_id IS NULL AND popular_times IS NOT NULL) AS popular_without_google_id,
       count(*) FILTER(WHERE google_place_id IS NOT NULL AND popular_times IS NOT NULL) AS popular_with_google_id
 FROM restaurant_place;

-- Q5: ชื่อร้านสาธารณะเท่านั้น ไม่คืน contacts หรือ precise coordinates
SELECT coalesce(name_th,name_en) AS name,name_en,raw_category AS category FROM restaurant_place
 WHERE lower(coalesce(name_th,'')||' '||coalesce(name_en,'')) ~ '(peppina|zuma|goji|paul)'
 ORDER BY coalesce(name_th,name_en) LIMIT 16;
ROLLBACK;
```

ข้อจำกัดสำคัญ: audit นี้ไม่ได้ตรวจ license/Terms ของแต่ละ source, ไม่ตรวจ Google/OSM live ว่าร้านยังอยู่, ไม่ตรวจเมนูปัจจุบัน, ไม่ยืนยัน delivery coverage/credit eligibility หรือ production mirror. ต้องทำ source-specific review และตรวจ buyer truth ก่อนใช้ข้อมูลออกไปหาลูกค้าจริง
