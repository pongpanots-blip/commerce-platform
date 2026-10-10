# Pushwoosh deep dive — 7 feature หลัก

- **วันที่:** 2026-10-10
- **ที่มา:** เปิดทุก panel / dropdown / ตัวเลือกใน Pushwoosh จริง (โปรเจกต์ `joshcje`) และส่งจริงในส่วนที่ทำได้
- **เอกสารที่เกี่ยวข้อง:**
  - ภาพรวม feature: [2026-10-10-pushwoosh-feature-spec.md](2026-10-10-pushwoosh-feature-spec.md)
  - ผลเทส: [2026-10-10-pushwoosh-features.md](2026-10-10-pushwoosh-features.md)
- **สัญลักษณ์:** ✅ = ลองแล้วทำงานจริง, 🔍 = เปิดดูตัวเลือกครบแต่ไม่ได้ส่ง/launch

| # | หัวข้อ | สรุปสั้น |
|---|---|---|
| 1 | [Visual Workflow](#1-visual-workflow-customer-journey-builder) | canvas ลากวาง, 30+ node, versioning, stats บนเส้น, ค้นเส้นทางของ user |
| 2 | [Event Trigger](#2-event-trigger) | event + attribute เริ่ม journey, wait for event, goal, cancel event, ยิง in-app |
| 3 | [Segmentation](#3-segmentation) | tag / event (นับครั้ง + ช่วงเวลา + attribute + sum) / segment / user ID / location, ซ้อน group |
| 4 | [A/B Testing](#4-ab-testing) | A/B/n + เลือกผู้ชนะอัตโนมัติ, Multi-Armed Bandit, Holdout, Control group |
| 5 | [Email](#5-email) | block editor + AI, audit ก่อนส่ง, marketing/transactional, ต้อง verify โดเมน |
| 6 | [Push](#6-push) | preset + ตั้งค่าแยก platform, Liquid, test device, inbox, frequency cap |
| 7 | [In-app](#7-in-app) | block editor เดียวกับ email, trigger ด้วย event, ตำแหน่ง/animation, ปุ่ม 3 action |

---

## 1. Visual Workflow (Customer Journey Builder)

### 1.1 หน้า list ของ journey
- **สถานะ:** All / Active / Inactive / Draft / Paused / Archived
- **Filter:**
  - category (จัดการ category เองได้)
  - entry type: API based / Audience based / Trigger based / **Mixed** (journey เดียวมีหลาย entry)
  - วันที่ launch และการเรียงลำดับ
- **แต่ละแถวแสดง:**
  - ชื่อ, สถานะ, แก้ล่าสุดเมื่อไหร่และโดยใคร
  - entry type, category, จำนวน version
  - Total reach, Reached goals, Avg. CTR
- **เมนูแต่ละแถว:** Edit / Rename / Clone / Delete
- **Export statistics** ได้จากหน้า list
- **สร้างใหม่ได้ 3 ทาง:**
  1. Build a journey from scratch
  2. Send a message on one channel: Push / In-app / Email / SMS / WhatsApp (สร้าง journey 1 ช่องทางสำเร็จรูป)
  3. Scenario templates (ตัวอย่างที่เห็นเป็นของ telecom เช่น bundle ใกล้หมด, ยอดเงินต่ำ, roaming)

### 1.2 Canvas
- ลาก node จาก toolbar ซ้ายมือ แล้วลากจาก port ขวาของ node ไปหา node ถัดไปเพื่อต่อเส้น
- **ดับเบิลคลิก** node เพื่อเปิด panel ตั้งค่า (Cancel / Save)
- **คลิกเดียว** = เลือก node มีปุ่ม Duplicate และ Delete ลอยขึ้นมา
- node ที่ตั้งค่าไม่ครบมี **จุดแดง** และ node ที่ยังไม่ต่อขาออกจะมีข้อความ "Add a step or keep as exit"
- บันทึก draft อัตโนมัติ (มุมซ้ายบนขึ้น "Saving… / Saved")
- **Add notes:** แปะโน้ตบน canvas ได้
- **Canvas settings:**
  - control scheme: Modern (แบบ Figma/Miro) หรือ Classic
  - left-drag เลือกได้ว่าใช้ select area หรือเลื่อน canvas
  - scroll/trackpad ตั้งเป็น auto-detect, เลื่อน หรือ zoom ได้ และกลับทิศได้
  - Snap to grid, Show metrics
- **Shortcut:**
  - Space+drag เลื่อน canvas, ⌘+scroll ซูม, ⌘0 = 100%, ⇧1 fit screen, ⇧M minimap, ⌘\ ซ่อน UI
  - เลือก: shift-click, ⌘A, Esc
  - action: Enter เปิด step, ⌫ ลบ, ⌘C/⌘V copy-paste, ⌘D duplicate, ⌘Z/⇧⌘Z undo-redo, ⌘S save, ⌘I copy UUID
- **ปุ่มบน canvas:** undo/redo, minimap, zoom, fullscreen, help, canvas settings, docs

### 1.3 เมนู journey (⋮)
- **ตอน Draft:** Save, Rename, Clone, Validate, Launch
- **ตอน Active (เมนูสถานะ):** Pause to edit, Clone, Rename, Stop campaign
- **Validate:**
  - แสดงรายการ error ทีละข้อพร้อมปุ่ม Revalidate และลูกศรเลื่อนไป error ถัดไป
  - เช่น "Please enable at least one push notification platform"
- **Launch:** ยืนยันอีกครั้งพร้อมข้อความ "แก้ไขได้หลัง pause"

### 1.4 ตอน journey Active (โหมดดูผล)
- **แผงซ้าย:**
  - Performance: % goal ต่อ goal
  - Audience: Entrances, In journey now, Exits
  - Communications: ช่องทาง, rate, sent
  - Campaign health: entrances, goals achieved, drop-offs
- **บน canvas:**
  - ตัวเลขจำนวนคนบนเส้นเชื่อมทุกเส้น
  - จำนวนคนที่ออกตรงแต่ละ branch
- **คลิก node:** โชว์ goal, drop-offs, opens, open rate ของ node นั้น
- **Find user path:** ค้นด้วย user ID แล้วไฮไลต์เส้นทางที่ user คนนั้นเดินผ่าน ✅
- **History:**
  - **Versions:** Version 1 ACTIVE ("Open for entries · 0 users left") มีเมนูต่อ version
  - **Change log:** ใคร ทำอะไร เมื่อไหร่ (Created, Goal changed, Campaign launched)
- เลือกช่วงวันที่ของสถิติได้

### 1.5 Node ทั้งหมด

**Entry**

| Node | ตั้งค่า |
|---|---|
| Audience-based | segment, one-time หรือ recurring, ส่งทันทีหรือตั้งวัน, คนเดิมเท่านั้น / คนเดิม+ใหม่ / คนใหม่เท่านั้น |
| Trigger-based | ดู [หัวข้อ 2](#2-event-trigger) |
| API-based | เพิ่ม placeholder แทนข้อความใน push/email ได้, มี request template `POST https://app.pushwoosh.com/api/journey/<journeyId>/start/external` ระบุคนที่เข้าผ่าน `filter` (Segmentation language) |

**Flow**

| Node | ตั้งค่า |
|---|---|
| Time Delay | Fixed duration (วัน/ชม./นาที สูงสุด 30 วัน), Specific time, Date, Day of week, Based on user/event data |
| Wait for Trigger | รอ event ได้หลาย branch (แต่ละ branch มีชื่อ + event + เงื่อนไข), timeout สูงสุด 90 วัน, branch "Not triggered", Fixed waiting period (รอครบเวลาแม้ event เกิดก่อน) |
| Condition Split | แยกตาม Segment (อยู่/ไม่อยู่) / Tag (หลาย branch ตามค่า) / Event attribute (หลาย branch), เลือกเช็กทุก device ของ user หรือเฉพาะ device ที่เข้ามา |
| Reachability Check | ส่งไปช่องทาง**แรก**ที่ติดต่อได้ตามลำดับที่เรียง (Push: all/iOS/Android/Web/Desktop/Amazon, In-Apps, Email, SMS, WhatsApp, LINE, Wallet Pass) |
| A/B/n Split | ดู [หัวข้อ 4](#4-ab-testing) |
| Holdout Split | % ที่กันไว้ ออกจาก journey ทันทีและไม่ได้รับอะไร (ห้ามต่อขาออก) |
| Loop | วนกลับไป step ก่อนหน้า, จำนวนรอบสูงสุด, ห่างกันอย่างน้อยกี่วินาที (≥60 วินาที ยกเว้นในลูปมี delay หรือ wait), เตือนให้เปิด frequency cap |
| Update User Profile | ตั้ง tag: Manual value หรือ Dynamic value (ดึงจาก event attribute) |
| Audience sync | เพิ่ม/ลบ user ใน Meta Ads audience (ต้องต่อ integration ก่อน) user ที่ไม่มี identifier จะถูกข้าม |

**Channel:** Push, Email, In-App, SMS, WhatsApp, LINE, Kakao, Telegram, Viber, FB Messenger, Data to app, App inbox, Live Activity, Issue wallet pass, Webhook, Multi-Armed Bandit

**Integration:** HubSpot (4 action), Salesforce, Dynamics 365, Airtable, BigQuery, Fabric, Snowflake, Supabase, Gemini, LLM, OpenAI, Adjust, Amplitude (2), AppsFlyer, Mixpanel (2), Adapty (2), Google Sheets, Mattermost, Slack

**Webhook node:** URL, method, headers, body JSON + macros (`{{device:hwid}}`), Data builder, Dynamic data, **Response mapping** (ผลตอบกลับไปลง tag), ปุ่ม Test webhook

### 1.6 Journey settings (ปุ่ม Settings)

| Setting | ตัวเลือก |
|---|---|
| Conversion goals | หลาย goal, event + เงื่อนไข attribute, conversion period หลังออกจาก journey (สูงสุด 30 วัน), "End journey after this event" |
| Silence period | แยกช่องทาง (Push / Email / In-app / SMS / WhatsApp / LINE), ช่วงเวลา hh:mm–hh:mm, ตารางรายวันอาทิตย์–เสาร์ หรือ "pause for entire day" **ถ้าตกช่วงงดส่ง ผู้ใช้จะไม่ได้รับข้อความและไปต่อ step ถัดไปทันที** |
| Campaign Entry Limit | No limits / Custom period ("Once in …" หรือเข้าได้ครั้งเดียวตลอดไป) |
| Cancel events | ถ้าเกิด event เหล่านี้ เอาผู้ใช้ออกจาก journey (ไม่นับเป็น conversion) |

### 1.7 กฎการทำงานที่ยืนยันแล้ว ✅
- payload ของ push จาก journey มี `isCJMessage: true` และ point id
- โดน frequency cap หรือ silence period แล้ว **ข้อความไม่ถูกส่ง แต่ผู้ใช้เดินต่อ** ไม่ค้างใน journey
- Launch แล้วต้อง pause ก่อนถึงจะแก้ได้ และระบบเก็บเป็น version

---

## 2. Event Trigger

### 2.1 การนิยาม event
- สร้างใน Audience → Events → Custom Event:
  - ชื่อ, คำอธิบาย
  - attribute หลายตัว ชนิด integer / string / boolean / list / decimal (price) / date / version / timezone
- ระบบโชว์โค้ด SDK ทันที (JS / Swift / ObjC / Java):
  ```js
  Pushwoosh.push(api => api.postEvent('TEST_ProductView', { product_id: 'SKU', price: 199.5 }));
  ```
- **System events อัตโนมัติ:** `PW_DeviceRegistered`, `PW_ApplicationOpen`, `PW_ApplicationMinimized`, `PW_ScreenOpen`, `PW_PopupFormImpression`, `PW_PopupFormVisit`
- หน้า list มี activity 7 วันต่อ event และ "Conversion events tracking" สำหรับ map revenue

### 2.2 Trigger-based Entry

| ตัวเลือก | ค่า |
|---|---|
| Event | เลือกจาก event ที่สร้างไว้ |
| Add condition | attribute + operator (ตัวเลข: is / is not / ≥ / ≤ / between; string: is / is not / contains ฯลฯ) |
| Who enters | **Users who perform the event** หรือ **Recipients linked to event performers via attribute** (ส่งหาคนอื่นที่อ้างถึงใน event เช่น ผู้ขาย/ผู้ติดตาม) |
| When is entry available | Allow entry at any time / Limit entry to a specific period |
| Sessions | One active session per user / Multiple active sessions per user (แยก session ด้วย attribute ที่ไม่ซ้ำ เช่น order_id) |
| Re-entry | Do not allow / Allow (เข้าซ้ำ = ล้าง session เก่าแล้วเริ่มใหม่) |

### 2.3 Event ในส่วนอื่น

| ที่ใช้ | ทำอะไร |
|---|---|
| Wait for Trigger | รอ event ใน journey (หลาย branch) |
| Conversion goals | นับ conversion ด้วย event |
| Cancel events | เอาออกจาก journey ด้วย event |
| Condition Split | แยก branch ตาม event attribute |
| Time Delay | รอถึงเวลาที่อยู่ใน event/user data |
| Push / Email node | "Personalise message with event attributes" และ "Overwrite Liquid placeholders" (ใช้ค่าจาก event แทน tag) |
| Instant in-app | ยิง in-app เมื่อเกิด event + attribute |
| Segment | Who did event (ดู [หัวข้อ 3](#3-segmentation)) |
| Retention | event A → event B |
| A/B, MAB | ใช้ event เป็น goal / reward |

### 2.4 ผลที่ยืนยันแล้ว ✅
1. `postEvent(TEST_ProductView)` → เข้า journey → Wait for `TEST_Purchase` 1 นาที
2. ถ้าไม่ซื้อ → push ถึงใน **67 วินาที** (รอ 1 นาที + เวลาส่ง)
3. ถ้าซื้อใน 8 วินาที → ออกทาง branch Purchased ไม่มี push และ goal นับ 1
4. หน้า Events นับ activity ขึ้นภายในไม่กี่นาที

---

## 3. Segmentation

### 3.1 Segment builder
- **Filter 5 แบบ:** Tag / Event / Segment (segment ซ้อน segment) / User ID / Location radius
- **ภายใน group** เลือก AND หรือ OR ระหว่าง filter ได้
- **หลาย group** ทำงานเหมือนวงเล็บ เช่น (A and B) or C
- **"Include all of a user's devices":** ถ้า device ไหนของ user ตรงเงื่อนไข ให้รวมทุก device ของ user นั้น
- **Estimated size real-time** แยก 9 ช่องทาง (mobile push, web push, email, SMS, WhatsApp, LINE, Kakao, Telegram, Viber)
- **หลังบันทึก:** กด Refresh เพื่อคำนวณ unique users + devices ต่อช่องทาง (มีเวลาที่คำนวณล่าสุด)

### 3.2 Tag filter

| ชนิด tag | Operator |
|---|---|
| String | is, is not, starts with, ends with, contains, in, not in, not set, any |
| Number / Price | is, is not, greater or equals, less or equals, between, in, not in, not set, any |
| Date | relative days ago (เช่น segment ตั้งต้น `First Install daysago ≤ 1`, `Last Application Open daysago = 3`) |
| Country | is + เลือกประเทศจากรายการ |

### 3.3 Event filter

```
Who did [event] [exactly | exactly or more | exactly or less | never] [N] times
        [ช่วงเวลา]
        and with [attribute] [operator] [value]      (+ Attribute ได้หลายตัว)
        and sum of [numeric attribute] [operator] [value]   (+ Sum)
```

**ช่วงเวลาที่เลือกได้:**
- **Relative:** during the last N days, exactly N days ago, N or more days ago, between N and M days ago, between N and M days **ahead**
- **Specific:** on a date, on or after, on or before, between dates

> ตัวอย่างที่ทำได้: "ซื้อ ≥ 3 ครั้งใน 90 วัน และยอดรวม price ≥ 10,000"

### 3.4 Location radius
- ค้นที่อยู่หรือใส่ lat/long บนแผนที่ (OpenStreetMap)
- กำหนดรัศมีเป็นเมตร (ค่าเริ่มต้น 1000)

### 3.5 Segmentation แบบอื่น

| Feature | ทำอะไร |
|---|---|
| Segments ตั้งต้น | new users, inactive 3/7 วัน, purchased, push enabled, all users |
| RFM | เลือก purchase event + monetary attribute แล้วคำนวณ R/F/M (ไม่มี monetary ก็คิดแค่ R และ F ได้) |
| External segments | PostgreSQL / MySQL / BigQuery / SQL Server-Fabric: host, port, db, user, password, SSL mode แล้วเขียน query ที่**คืนคอลัมน์ `user_id` เดียว** มี Check connection และ Check query |
| Import CSV | update tag values, push subscribers, events, contacts, subscription categories |
| Condition Split ใน journey | แยกตาม segment / tag / event attribute ระหว่างทาง |
| ตอนส่ง | one-time message เลือก segment / user ID list / email list / ทุกคน |

### 3.6 ผลที่ยืนยันแล้ว ✅
- segment `Country = Thailand` คำนวณได้ 1 user / 1 web device หลังกด Refresh
- Country และ City ถูกใส่จาก IP อัตโนมัติตอน subscribe

---

## 4. A/B Testing

### 4.1 A/B/n Split (node ใน journey)

| ตัวเลือก | ค่า |
|---|---|
| จำนวน branch | 2 / 3 / 4 (A เป็น **Control**) |
| สัดส่วน | % ต่อ branch, ปุ่ม Reset distribution |
| เลือกผู้ชนะ | **You select the winner manually** หรือ **Winner is selected automatically by goal** |
| Goal ที่ใช้ตัดสิน | "First goal to achieve significance" หรือ goal ที่ระบุ (ต้องตั้ง Conversion goal ของ journey ก่อน) |
| เมื่อมีผู้ชนะ | ปิด branch ที่แพ้ และผู้ใช้ใหม่ทั้งหมดไป branch ที่ชนะ |

- แต่ละ branch ต่อ node อะไรก็ได้ (คนละข้อความ, คนละช่องทาง, คนละ delay)

### 4.2 Multi-Armed Bandit (node, experimental)

| ตัวเลือก | ค่า |
|---|---|
| Content variants | Variant 1, 2, … + Add variant |
| Reward | **Push opened** หรือ **Event happened** (เลือก event) |
| Reward window | สูงสุด 72 ชั่วโมง (เริ่มเทียบหลังส่งครั้งแรกไปแล้วครบ window) |
| Send settings | Marketing/Transactional, frequency cap, send rate |

- ต่างจาก A/B ตรงที่ค่อยๆ ส่งตัวที่ดีกว่ามากขึ้นอัตโนมัติ ไม่ต้องรอตัดสินผู้ชนะ

### 4.3 Holdout Split (node)
- % ที่กันไว้ไม่ให้ได้อะไรใน journey นี้ ใช้วัดว่า journey นี้ทำให้ยอดเพิ่มไหม

### 4.4 Control groups (ระดับโปรเจกต์)
- **ขนาด:** 3% (Max reach), 5% (Recommended), 10% (Most reliable), Custom
- **Mode:**
  - Permanent: เลือกครั้งเดียว กันถาวร
  - Auto-refresh: สุ่มใหม่ทุกรอบ กลุ่มเก่ากลับมารับข้อความ
  - Experiment with end date: มีวันเริ่ม-จบ
- **จำกัดขอบเขต:** ตามประเทศ และ/หรือ tag
- **รายงาน:** ต่อ event (สูงสุด 10)
  - CONV. CONTROL vs CONV. TREATMENT, UPLIFT, SIGNIFICANCE
  - อัปเดตวันละครั้ง, ปุ่ม Recalculate
  - ดึง goal จาก goal point ของ journey ที่รันอยู่
- **กฎ:** กันเฉพาะ **Marketing** message ส่วน Transactional ยังส่งหา control group

### 4.5 สิ่งที่ไม่เจอ
- One-time message และ push preset **ไม่มี A/B ในตัว** ต้องทำผ่าน journey (A/B/n หรือ MAB)

---

## 5. Email

### 5.1 ตั้งค่าช่องทาง (บังคับก่อนส่ง)
1. **Account verification:** กรอกเว็บไซต์บริษัท, technical contact, use case แล้วรอ Pushwoosh review
2. **Sender configuration**
3. **Domain verification** (DNS)
4. **Link tracking**

### 5.2 Email content editor
- **สร้างได้ 3 ทาง:** from scratch (block editor), template กว่า 20 แบบ, from HTML code
- **Blocks:** Heading, Text, Button, Image, Logo header, Card, Divider, 2/3/4 columns, 33/67, 67/33, Group, Timer (countdown), Barcode, Menu, Social, HTML, Video, Products (จาก catalog), News (จาก RSS)
- **Saved blocks:** bookmark block ไว้ใช้ซ้ำ หรือ shift-click เลือกหลาย block แล้วเก็บรวมกัน
- **Layers panel:** โครงสร้าง card → block
- **เมนูของแต่ละ element:** add above/below, duplicate, delete, collapse
- **Settings tab:**
  - Document: ความกว้าง, padding, background image/gradient, block gap, มุมโค้ง, เงา, View in browser, Unsubscribe link
  - Color scheme, Typography
  - **Sender details:** From name/email, Reply-to name/email
  - ค่า default ของ Block / Columns / Card / Button group / Button / Divider
  - Brand book
- **AI tab:** แชตสั่งสร้างหรือแก้อีเมล (แนบรูปอ้างอิงได้), AI ช่วยเขียน subject และ preheader
- **อื่นๆ:**
  - subject + preheader
  - หลายภาษา (export/import CSV หรือ JSON)
  - Liquid
  - preview desktop / mobile 375px / light / dark (dark mode มี auto fold/lift)
  - undo/redo
- **Smart check (ปุ่ม Check):** ปุ่มไม่มีลิงก์, ไม่มีที่อยู่ไปรษณีย์ (CAN-SPAM/GDPR), preheader ว่าง

### 5.3 ส่ง email แบบ one-time (wizard 5 ขั้น)
1. **Content:** เลือก content, Marketing (เคารพ opt-out + frequency cap) หรือ Transactional (ข้าม opt-out + frequency cap)
2. **Audience:** segment / **email list** (พิมพ์อีเมลคั่นด้วย comma) / ทุกคน
3. **Sending time:** ทันที / ตั้งเวลา, frequency cap, send rate
4. **Audit:**
   - ส่งอีเมลจริงไปที่อยู่ทดสอบแล้วอ่านผลกลับมา
   - ตรวจ Content (subject ว่าง, ขนาดเกิน, ลิงก์เสีย/ไม่ปลอดภัย, spam signal) และ Compliance (unsubscribe)
5. **Review** → ส่ง

### 5.4 Email node ใน journey
- เลือก preset แล้ว override **subject** ได้
- Sender info: From name, From email, ใช้เป็น reply-to เพื่อเก็บ reply
- Marketing / Transactional
- Overwrite personalization ด้วย event attribute, Use Vouchers
- Frequency cap, Send rate, Best time to send
- **Split flow ตาม opened / ignored**

### 5.5 อื่นๆ
- **Email suppression list:** bounce และ spam complaint ระดับ account, ค้นหา/กรอง/export CSV, reactivate ได้
- **Subscription forms:** modal หรือ embed บนเว็บ + Double opt-in
- **News feeds:** RSS เข้า news block ทุกชั่วโมง

### 5.6 ผลเทส
- สร้าง content จาก template, Smart check และเดิน wizard ถึงขั้น Audit ได้ 🔍
- **ส่งจริงไม่ได้:** Run audit ไป pongpanot_s@jagota.co.th ได้ "unexpected error" เพราะช่องทาง email ยังไม่ verified จึงไม่มีอีเมลออกไป

---

## 6. Push

### 6.1 Push preset (content)
- **ประเภท:** Push notification / Product recommendations / News feed / Push stories
- **ข้อความ:**
  - Title, Subtitle, Message
  - หลายภาษา (ปุ่ม + เพิ่มภาษา, Import)
  - Liquid (`{{first_name|default:'ลูกค้า'}}`) + Validate Liquid
  - AI composer, AI translate, Fill from link
- **Media:** Banner URL (รูป/GIF), Icon
- **On-click:**
  - หน้าแรก (ค่าเริ่มต้น)
  - Open web page (URL เดียวทุก platform)
  - Deep link ในแอป (เลือกจากรายการ deep link template)
- **Custom data:** JSON
- **Notification settings แยก platform:**

  | Platform | ตั้งค่า |
  |---|---|
  | iOS | Badge (+1 / −1 / ค่าตายตัว), Sound (default / mute), Delivery priority: Critical / Active / Time-sensitive / Passive |
  | Android / Huawei | Sound, Delivery priority (Normal / High), Importance (None / Low / Medium / High / Urgent) |
  | ทุก platform | Root params (JSON ระดับ payload) |

- **Preview:** iOS / Android / macOS / Windows
- **Test push notification:** ส่งหา Test devices ทั้งหมด (บอกจำนวนเครื่อง) ✅
- **Approval + version:** เช่น `APPROVED · V1`

### 6.2 การส่ง push
- **One-time message (wizard 4 ขั้น):**
  1. Content: preset, Marketing/Transactional, Save to inbox, in-app banner เมื่อคลิก (mobile)
  2. Audience: segment / user IDs / ทุกคน, เลือก platform, ส่งเฉพาะ device ล่าสุด
  3. Time: ทันที / ตั้งเวลา / Best time (ต้องจ่ายเงิน), TTL, frequency cap, send rate
  4. Review → ใส่ชื่อ campaign → Send now ✅
- **Push node ใน journey:**
  - Marketing/Transactional
  - Personalise ด้วย event attribute, Overwrite Liquid, Use Vouchers
  - Save to inbox, TTL
  - frequency cap, send rate (ค่ากลางหรือ override), Best time
  - ส่งทุก device ของ user หรือ device ล่าสุด
  - **split flow ตาม opened / delivered** ภายในเวลาที่กำหนด
- **Multi-Armed Bandit node:** หลาย variant ของ push

### 6.3 กฎการส่ง
- **Frequency capping:**
  - N ข้อความต่อ X วัน แยกช่องทาง
  - นับแบบ rolling window หรือ calendar day
  - ยกเว้นผู้ใช้รายคนได้
  - มีผลกับ API ด้วย
  - ถ้าโดน cap ใน journey ผู้ใช้จะไปต่อ step ถัดไป
- **Silence period:** ตามตารางรายวัน (ดู 1.6)
- **Marketing vs Transactional:** ดู 4.4 และ 5.3
- **Inbox:** "Save to inbox" เก็บข้อความไว้ (ค่าเริ่มต้น 1 วัน) และยังเห็นใน inbox แม้โดน cap

### 6.4 Web push เฉพาะ
- ตั้งค่า VAPID อัตโนมัติ, snippet + service worker
- **Subscription bell + invitation** ตั้งจากหน้า admin (ดู feature spec)
- **Inbox widget** บนเว็บ (`#pwInbox`) ✅

### 6.5 ผลที่ยืนยันแล้ว ✅
- Test push, journey (audience และ trigger), one-time หา user ID: ถึง Chrome ทุกครั้ง
- Liquid ดึง `first_name` จาก tag ได้ ถ้าไม่มีจะใช้ default
- payload มี `user_id` และมี `isCJMessage` ถ้ามาจาก journey

---

## 7. In-app

> In-app ต้องใช้แอปมือถือที่ติด SDK จึงไม่ได้ทดสอบแสดงผลจริง (ฝั่งเว็บใช้ Web popup แทน ซึ่งเทสผ่านแล้ว)

### 7.1 In-app content editor
- **Block editor ตัวเดียวกับ email:** Heading, Text, Button, Image, Card, Columns, Timer, Barcode, Menu, Social, HTML, Video, Products, News + saved blocks
- **Template ตั้งต้น 9 แบบ (HTML):** Rate My App, Network Promoter Score, Push Opt-In, Advertising Banner, Don't miss special, Welcome aboard, Showcase app changes, Increase Push Opt-in rate, Recover opted-out users
- **ปุ่มใน in-app มี 3 action:**
  1. Open Website
  2. URL or Deeplink
  3. Custom JavaScript
- **Style ปุ่ม:** alignment, background, text color, font, มุมโค้ง, border, width, padding
- **In-app settings (iOS/Android native):**
  - Position: Fullscreen / Top / Center / Bottom
  - Present animation และ Close animation: None / Fade / Left / Right / Up / Down / Default + duration (ms)
  - Swipe to close: ซ้าย/ขวา/ขึ้น/ลง
  - Close button: แสดงหรือไม่, ตำแหน่ง 4 มุม, background, มุมโค้ง, สี icon
  - Margin บน/ขวา/ล่าง/ซ้าย
- **อื่นๆ:**
  - หลายภาษา (export/import)
  - preview 360px, light/dark
  - Preview, Check, Brand book (apply/reset styles)
  - AI chat (แนบรูปได้)

### 7.2 Instant in-app campaign (wizard 4 ขั้น)
1. **Content:** เลือก in-app banner (เรียงเก่า/ใหม่), Marketing / Transactional, preview
2. **Target users:**
   - Trigger event (+ attribute) เช่น โชว์หลัง `TEST_ProductView`
   - ผู้รับ: All users with the mobile app หรือ Users matching filters (by behavior / existing segment / custom conditions)
3. **Display settings:**
   - Start: ทันที / ตั้งวัน
   - End: never / หลังวันที่กำหนด
   - Timezone ของตารางเวลา, frequency cap
4. **Review** → launch (ไม่ได้ launch)

### 7.3 In-App node ใน journey
- เลือก in-app content (media source)
- **In-app expiration:** หมดอายุหลัง N วัน ถ้าผู้ใช้ยังไม่เปิดแอปจะไม่เห็นอีกเลย
- Marketing / Transactional, frequency cap

### 7.4 In-app ที่ใช้ร่วมกับช่องทางอื่น
- **Push:** ตัวเลือก "Show in-app banner when message is clicked" (mobile only)
- **Reachability Check:** In-Apps เป็นหนึ่งในช่องทางที่ fallback ไปได้ เช่น ใช้ in-app ขอ opt-in push จากคนที่ปิดแจ้งเตือน

---

## Checklist ถ้าจะสร้างเอง (ระดับ feature)

| หัวข้อ | ต้องมี (MVP) | ทำทีหลัง |
|---|---|---|
| Visual Workflow | canvas ลากวาง + ต่อเส้น, node settings panel, draft autosave, validate, launch/pause/stop, จำนวนคนบนเส้น + stats ต่อ node | versions + change log, find user path, canvas settings/shortcut, templates, notes |
| Event Trigger | นิยาม event + attribute, trigger entry + เงื่อนไข attribute, re-entry, wait for event + timeout, conversion goal | multiple sessions, who-enters-via-attribute, cancel events, entry period |
| Segmentation | tag filter (string/number/date), event filter (count + ช่วงเวลา + attribute), AND/OR + group, estimated size, refresh | sum of attribute, location radius, segment-in-segment, external DB, RFM |
| A/B Testing | A/B/n split + สัดส่วน + เลือกผู้ชนะเอง, holdout split | auto-winner ตาม significance, multi-armed bandit, control group ระดับโปรเจกต์ + uplift |
| Email | block editor + template, Liquid, sender/reply-to, unsubscribe, marketing/transactional + opt-out, test send | AI, audit (spam/links), brand book, split opened/ignored, suppression list |
| Push | preset (title/message/รูป/link/data), Liquid, test device, one-time + journey node, frequency cap, marketing/transactional | per-platform settings, approval/version, best time, MAB, inbox |
| In-app | block editor, ปุ่ม 3 action, position/close, trigger ด้วย event, start/end | animation/swipe, expiration ใน journey, fallback จาก reachability |

## เทียบกับ marketing workflow phase 1 ของเรา (master `221cb30`)

อ่านจากโค้ด (`modules/integration/marketing-workflow`, `commerce-admin/.../marketing-workflow`, `modules/integration/segments`) และ
`.claude/completions/2026-10-10-marketing-workflow-phase1.md` — ยังไม่ได้รันหรือเปิดหน้าจอ

| หัวข้อ | มีแล้ว | ยังขาดเทียบ MVP ข้างบน |
|---|---|---|
| Visual Workflow | canvas ลากวาง + ปุ่ม + ต่อจาก node, แผงตั้งค่า, auto layout, validate ก่อน activate, activate/pause, ประวัติฉบับแก้ไข (versions), รันทดสอบกับ tester | autosave (ตอนนี้กดบันทึกเอง), จำนวนคนบนเส้น + stats ต่อ node บน canvas (มีแค่แท็บผลลัพธ์), stop แยกจาก pause |
| Event Trigger | trigger: scheduled, order milestone, first login, app login · cooldown (re-entry) · conversion window + exit on goal · ช่วงเวลาทำงาน | custom event + attribute, Wait for event + timeout, goal อื่นนอกจาก `order_placed` (ตะกร้า / page view / custom อยู่เฟส 2) |
| Segmentation | segment builder เดิม: AND/OR ซ้อน, ยอดซื้อ / จำนวนออเดอร์ / 90 วัน / tier / cuisine · ใน flow: Audience include/exclude, condition `segment.in` | event filter (ทำ X ≥ N ครั้งใน Y วัน), tag/attribute อิสระ |
| A/B Testing | A/B split 2–4 กิ่ง กำหนด % (sticky ด้วย hash), holdout % ต่อ workflow, ผลต่อกิ่ง + holdout เทียบกลุ่มที่ได้ข้อความ | auto-winner, multi-armed bandit (ตรงกับ "ทำทีหลัง") |
| Email / Push / In-app | node notify 3 ช่องทางผ่าน josh (template ของ josh), แจกคูปอง, webhook (SSRF guard + secret เข้ารหัส) | content editor ของเราเอง (block editor / preset), marketing vs transactional, ผลส่งจริงกลับมา (ตอนนี้ `queued`), frequency cap รวมระบบเดียว (เฟส 3) |

**สรุป:** engine + editor ใกล้ MVP แล้ว และเกินในบางเรื่อง (versions, tester test-run, webhook) ·
ช่องว่างใหญ่สุดคือชั้น event (custom event, wait for event, segment ตาม event) ซึ่งเป็นแกนของ Pushwoosh ·
รองลงมาคือ content editor · ควรเพิ่มจำนวนคนบนเส้น / stats ต่อ node บน canvas ในเฟสถัดไป
