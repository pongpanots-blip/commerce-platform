# ชั้น Event ของ marketing workflow (ก้อน 1/4 ของการเติมช่องว่างเทียบ Pushwoosh) — design

อ้างอิง: `docs/research/2026-10-10-pushwoosh-deep-dive.md` (ส่วน "เทียบกับ marketing workflow phase 1"),
`docs/superpowers/specs/2026-10-10-marketing-workflow-builder-design.md` (phase 1)

## 1. เป้าหมาย ขอบเขต

commerce เป็นเจ้าของข้อมูลพฤติกรรมลูกค้า (event) เอง เพื่อลด load ของ josh และเป็น hub ให้แพลตฟอร์มอื่นในอนาคต
แล้วใช้ event นั้นใน workflow แบบ Pushwoosh

**ก้อนนี้มี:**
1. Ingest API เส้นเดียว `POST /api/events` — shop-web และมือถือยิงเส้นเดียวกัน
2. Event catalog (admin นิยาม event + attribute + ชนิด)
3. ผูก device → user ด้วย device id (แบบ HWID) จาก `user_devices` ของ josh และ merge event ทุกตัวเข้ากับ user
4. Trigger แบบ `event` + เงื่อนไข attribute
5. Step `wait_event` (Wait for event + timeout, ทางออก "เกิดขึ้น" / "หมดเวลา")
6. Goal แบบ event
7. Segment rule ตาม event (ทำ X กี่ครั้ง ในช่วงเวลา ที่ attribute ตรง)
8. ตัวแปร `{{event.<key>}}` ใน notify / webhook
9. หน้า admin "Events" + เก็บข้อมูลแบบไม่บวม (อายุ 90 วัน, สรุปรายวัน)
10. shop-web ส่ง event เข้า commerce (ส่งเข้า josh ต่อด้วยจนถึง phase 3) · contract สำหรับมือถือ

**ก้อนถัดไป (spec แยก):** 2) สถิติบน canvas · 3) polish editor (autosave, stop) · 4) content editor

**ไม่อยู่ในก้อนนี้:** จับคู่ attribute ข้าม event (เช่น purchase ที่ order_id ตรงกับตอนเข้า), sum ของ attribute ใน segment,
operator ของ attribute ชนิด date, journey ของ guest (ยังไม่ login), แก้แอปมือถือ (ให้ contract ไป), partition / archive ไป S3,
ย้าย workflow ของ josh มา commerce (phase 3)

## 2. ข้อมูลที่มีอยู่แล้ว

- josh → commerce: snapshot ผ่าน outbox (`POST /internal/josh-events`, HMAC, version guard ต่อ aggregate) — ไม่มี event พฤติกรรม
- josh เก็บพฤติกรรมเอง: `analytics_events` (allowlist: view_item, add_to_cart, search, begin_checkout, purchase, login …),
  `marketing_page_view`, cart idle — shop-web `lib/analytics.ts` `track()` ยิง josh · มือถือยิงแค่ GTM dataLayer
- josh `user_devices`: `individual_id` (unique) → `user_id`, `platform`, อัปเดตตอน login และ `POST /auth/device`
  (web = device id ของ shop-web, mobile = OneSignal subscription id)
- commerce: Postgres + Redis/BullMQ · `Throttle` (express-rate-limit ต่อ IP) · `@Public()` · CORS จาก `COMMERCE_CORS_ORIGINS`
- ปริมาณ (shop_traffic 2026-09-11 → 10-10): ~8,000 event/เดือน, web อย่างเดียว

## 3. Ingest API

`POST /api/events` · `@Public()` · ปิดด้วย `MARKETING_EVENTS_INGEST_ENABLED` (ปิด → `503 { code: 'ingest_disabled' }`, client ทิ้งเงียบ)

```jsonc
// request
{ "deviceId": "uuid", "platform": "web" | "ios" | "android",
  "events": [ { "eventId": "uuid", "name": "add_to_cart", "occurredAt": "ISO-8601", "attributes": { "product_id": "SKU-1", "price": 199.5 } } ] }
// response 200
{ "results": [ { "eventId": "uuid", "status": "accepted" | "duplicate" | "rejected", "reason": "unknown_event" } ] }
```

- `events` 1–20 ตัว · body ≤ 32 KB · zod strict ทั้ง envelope (envelope เสีย → `400`)
- ต่อ event (เสียตัวไหน reject ตัวนั้น ตัวอื่นยังรับ):
  - `name` ต้องอยู่ใน catalog และ `status = active` → ไม่งั้น `unknown_event` / `archived_event`
  - attribute: เก็บเฉพาะ key ที่ประกาศ (ที่ไม่ประกาศตัดทิ้งเงียบ), ชนิดต้องตรง → ไม่งั้น `bad_attribute_type`;
    ≤ 20 key และ JSON ≤ 2 KB → ไม่งั้น `too_large`
  - `occurredAt` ไม่เกินอนาคต 5 นาที (`in_future`) และไม่เก่ากว่า 7 วัน (`too_old`)
  - `eventId` ซ้ำ → `duplicate` (unique constraint, `ON CONFLICT DO NOTHING`)
- Rate limit: `@Throttle` 120 request/นาที ต่อ IP + 60 event/นาที ต่อ `deviceId` (express-rate-limit memory store, key = deviceId)
  → `429` · ponytail: memory store ต่อ instance — เปลี่ยนเป็น Redis store ถ้ารัน commerce-platform มากกว่า 1 instance
- CORS: เพิ่มโดเมน shop ใน `COMMERCE_CORS_ORIGINS` (มือถือไม่ติด CORS)
- ในทรานแซกชันเดียว: insert event ที่ผ่าน + ใส่ `user_id` จาก link (§5) · หลัง commit enqueue job `marketing-event`
  (`{ eventIds }`) ไปทำ trigger / wait / goal (§6–8) — request ไม่รอ
- ไม่ log ราย request · log เฉพาะ error และตัวเลขรวม (accepted / duplicate / rejected ตาม reason) ทุก 5 นาที

## 4. ตาราง (migration ใหม่)

| ตาราง | คอลัมน์ | index / หมายเหตุ |
|---|---|---|
| `marketing_event_definitions` | `name varchar(64) PK` (`^[a-z][a-z0-9_]{1,63}$`), `label`, `description`, `attributes jsonb` (`[{ key, type: 'string'\|'number'\|'boolean', label }]`), `status` (`active`/`archived`), `created_at`, `updated_at` | seed: `view_item`, `view_category`, `search`, `add_to_cart`, `begin_checkout`, `purchase`, `login` (attribute ตาม `lib/analytics-events.ts` ของ shop-web) |
| `marketing_events` | `id bigserial PK`, `event_id uuid UNIQUE`, `device_id uuid NOT NULL`, `user_id uuid NULL`, `platform varchar(10)`, `name varchar(64)`, `attributes jsonb`, `occurred_at timestamptz`, `received_at timestamptz default now()` | `(user_id, name, occurred_at) WHERE user_id IS NOT NULL` · `(device_id, occurred_at)` · `(occurred_at)` |
| `marketing_device_links` | `id bigserial PK`, `device_id uuid`, `user_id uuid`, `platform varchar(10)`, `linked_at timestamptz` | `UNIQUE (device_id, linked_at)` · `(user_id)` |
| `marketing_event_daily` | `date date`, `name`, `platform`, `events int`, `users int` | `PK (date, name, platform)` เก็บถาวร |
| `marketing_workflow_enrollments` (เพิ่ม) | `waiting_for jsonb NULL` (`{ stepId, eventName, filters, since }`), `trigger_event jsonb NULL` (`{ eventId, name, attributes }`) | |

- `marketing_workflows.trigger_type` ไม่มี CHECK อยู่แล้ว — เพิ่ม `'event'` ที่ zod / types
- `event_id` unique ปลอดภัยกับการลบ 90 วัน เพราะ event เก่ากว่า 7 วันถูก reject ตั้งแต่ทางเข้า

## 5. Device link และการ merge event เข้ากับ user

**ที่มา:** josh ส่ง `device.snapshot` ผ่าน outbox เดิม `{ individualId, userId, platform }` (aggregateId = `user_devices.id`)
เฉพาะตอน `user_id` ของแถวเปลี่ยน (รวมแถวใหม่) · `linked_at` = `occurredAt` ของ envelope

**commerce รับ `device.snapshot`** (ใน `josh-events.service.ts`, ทรานแซกชันเดียวกับ version guard เดิม):
1. insert `marketing_device_links (device_id, user_id, platform, linked_at)` — ถ้า link ล่าสุดก่อนหน้า `linked_at` ของ device นี้เป็น user เดิมอยู่แล้ว → ไม่ insert
2. หาช่วงที่ link นี้ครอบ: `start` = `linked_at` (ถ้าไม่มี link ก่อนหน้าของ device → `-∞`), `end` = `linked_at` ของ link ถัดไป (ไม่มี → `∞`)
3. `UPDATE marketing_events SET user_id = :user WHERE device_id = :device AND occurred_at >= :start AND occurred_at < :end`
4. หลัง commit: enqueue `marketing-event` ของ event ที่ถูกเติม user และ `occurred_at ≥ now − 60 นาที`
   (trigger ทำซ้ำได้ปลอดภัยเพราะ `occurrence_key = event_id`)

**ตอน ingest:** `user_id` = user ของ link ล่าสุดที่ `linked_at ≤ occurred_at` · ไม่มี → user ของ link แรกของ device · ไม่มี link เลย → `NULL`

**กติกา (ตัวอย่าง device D: guest → login A → login B):** event ตอน guest และช่วง A → A · หลัง login B → B ·
link มาถึงช้ากว่า event หรือมาไม่เรียงก็ได้ผลเดียวกัน เพราะคำนวณจากช่วงเวลาทุกครั้ง · ทุก event เก็บ `device_id` เสมอ
(ดูได้ทั้ง device → user และ user → ทุก device)

**ข้อจำกัดที่รับได้:** josh ไม่ unlink ตอน logout → event หลัง logout บน device ร่วมนับเป็นของคนล่าสุด

## 6. Trigger `event`

`trigger_config = { eventName, filters: [{ key, op, value }] }` (filters AND กัน, ≤ 10)

| ชนิด attribute | op |
|---|---|
| string | `eq`, `neq`, `contains`, `in` (≤ 50 ค่า) |
| number | `eq`, `neq`, `gt`, `gte`, `lt`, `lte` |
| boolean | `eq` |

- job `marketing-event` ต่อ event ที่มี `user_id` และ `occurred_at ≥ now − 60 นาที` (`TRIGGER_RECENT_MINUTES` เดิม):
  workflow ที่ `active`, `trigger_type = 'event'`, `eventName` ตรง, filters ผ่าน → `engine.enroll(wf, userId, occurrenceKey = event_id)`
  พร้อม `trigger_event = { eventId, name, attributes }`
- gate เดิมทั้งหมด (schedule, cooldown, audience, holdout) · นับเฉพาะ event หลัง `activated_at`
- ตัวประเมิน filter เป็น pure function เดียว (`domain/event-filter.ts`) ใช้ร่วมกับ §7, §8 · key / ชนิดตรวจกับ catalog ตอน validate

## 7. Step `wait_event`

```ts
{ id, type: 'wait_event', eventName, filters, timeoutHours, timeoutMinutes?, matchedNextId, timeoutNextId }
```

- timeout รวม ≤ 30 วัน (`LIMITS.maxWaitMinutes`) · นับรวมกับ `maxWaitSteps` (3) เดียวกับ `wait`
- ถึง step: `waiting_for = { stepId, eventName, filters, since: now }`, `resume_at = now + timeout`, park แบบ `wait` เดิม
- job `marketing-event` (event มี `user_id`): หา enrollment `running` ของ user ที่ `waiting_for->>'eventName' = name` และ
  `occurred_at ≥ since` → filters ผ่าน → ล็อกแถว (`FOR UPDATE`), เช็กว่า `waiting_for.stepId` ยังเป็น step ปัจจุบัน →
  ล้าง `waiting_for`, `current_step_id = matchedNextId`, `queue.step` ทันที · action log `wait_event` (`meta: { matched: true, eventId }`)
- ครบเวลา: sweep / delayed job เดิม → `walk()` เห็น `waiting_for` ยังอยู่ → ล้าง, เดิน `timeoutNextId` · log `{ matched: false }`
- แข่งกัน (event มาพร้อม timeout): ทั้งสองทางล็อกแถว ใครก่อนได้ไป อีกทางเห็น `waiting_for` ว่าง / step เปลี่ยน → ข้าม
- tester `skipWaits`: ถือว่าหมดเวลาทันที (เดิน `timeoutNextId`)
- `nextIdsOf`: `wait_event` → `[matchedNextId, timeoutNextId]`

## 8. Goal แบบ event

`exit_on_goal = { kind: 'order_placed' } | { kind: 'event', eventName, filters }`

- เช็กก่อน action / webhook ทุกตัว (เหมือนเดิม): มี event ของ user ที่ตรง goal และ `occurred_at ≥ started_at` → `skipped: goal_reached`
- conversion: job `marketing-event` → enrollment ของ user ที่ goal ตรง, `started_at` อยู่ใน `conversion_window_days`, ยังไม่มี
  `converted_at` → ตั้ง `converted_at` (goal `order_placed` ใช้ทาง `order.snapshot` เดิม)

## 9. Segment rule ตาม event

leaf ใหม่ใน `segment-definition.compiler.ts`:

```ts
{ field: 'event', event: { name, op: 'gte' | 'eq' | 'lte', count, window: { lastDays } | { from, to }, filters } }
```

- compile เป็น `(SELECT count(*) FROM marketing_events e WHERE e.user_id = <user id ของ query> AND e.name = $n
  AND e.occurred_at >= $n [AND e.occurred_at < $n] AND <filters>) <op> $n` — ทุกค่าเป็น parameter, key ตรวจกับ catalog,
  number cast `(e.attributes->>$k)::numeric`
- `lastDays` 1–90 · `from`/`to` ต้องอยู่ใน 90 วันล่าสุด · `count` 0–1000 (`eq 0` = "ไม่เคยทำ")
- ใช้ร่วม AND/OR กับ leaf อื่นได้ · ใช้ได้ทุกที่ที่ใช้ segment: node Audience, `segment.in`, scheduled, `userMatchesSegment`
- ตัวสร้าง segment ใน admin: เพิ่มชนิด rule "Event" (เลือก event, ครั้ง, ช่วงเวลา, เงื่อนไข attribute)

## 10. ตัวแปร event ในข้อความ

- notify: `data.event = trigger_event.attributes` ส่งไปกับ `marketing.notify` (template ของ josh ใช้ได้)
- webhook: ตัวแปร `{{event.<key>}}` และ `{{event.name}}` ใน `webhookVars` (escape ตาม `template.ts` เดิม)
- workflow ที่ไม่ได้มาจาก event: ตัวแปร event ว่าง · validator เตือนถ้าใช้ `{{event.*}}` ใน workflow ที่ trigger ไม่ใช่ `event`

## 11. Admin

**API (staff auth + role marketing เดิม):**
`GET/POST /api/marketing/events/definitions`, `PUT /api/marketing/events/definitions/:name`,
`POST /api/marketing/events/definitions/:name/archive`, `GET /api/marketing/events?deviceId&userId&name&page`,
`GET /api/marketing/events/daily?from&to`

**กฎ catalog:**
- `name` และ `type` ของ attribute แก้ไม่ได้หลังสร้าง · เพิ่ม attribute ได้ · ลบ = archive
- archive event หรือ attribute ที่ workflow `active` ใช้อยู่ (trigger / wait_event / goal / filters) หรือ segment ใช้อยู่ → `409`
  พร้อมรายชื่อที่ใช้
- ชื่อ attribute ที่เข้าข่าย PII ถูกปฏิเสธ: `email`, `phone`, `tel`, `mobile`, `name`, `first_name`, `last_name`, `address`,
  `id_card`, `citizen_id`, `password`, `token` (เทียบแบบไม่สนตัวพิมพ์ และ `_` / `-`)

**หน้า `/marketing/events`:** ตาราง catalog + ฟอร์มสร้าง/แก้ · แท็บ "Event ล่าสุด" (ค้นด้วย device / user / ชื่อ) ·
แท็บ "รายวัน" (ตารางจาก `marketing_event_daily`) · คำเตือนห้ามประกาศ PII

**Editor workflow:**
- palette ENTRY เพิ่ม "Event" · FLOW เพิ่ม "Wait for event" (การ์ด 2 ทางออก: เกิดขึ้น / หมดเวลา)
- ฟอร์ม trigger / wait_event / goal: เลือก event จาก catalog, filter ที่ช่องค่าเปลี่ยนตามชนิด
- รันทดสอบ: workflow ที่ trigger เป็น `event` ใส่ attribute ตัวอย่างได้ (`testRunSchema` เพิ่ม `eventAttributes?`)
- validator ใหม่:
  - trigger `event` + มี node แจกคูปอง → ต้อง `cooldown_days ≥ 1` (ไม่งั้น activate ไม่ได้) และเตือนให้ใช้ trigger
    ฝั่ง server (order milestone) สำหรับคูปองมูลค่าสูง — event จาก client ผู้ใช้ปลอมให้ตัวเองได้
  - event / attribute ที่อ้างถึงต้องอยู่ใน catalog และ `active`

## 12. Retention และขนาดข้อมูล

- job รายคืน 03:00 Asia/Bangkok (BullMQ repeatable บนคิว `marketing-workflow`):
  1. upsert `marketing_event_daily` ของเมื่อวาน (นับซ้ำได้ ผลเท่าเดิม)
  2. ลบ `marketing_events` ที่ `occurred_at < now − 90 วัน` ทีละ 5,000 แถวจนหมด
  3. ลบ `marketing_workflow_action_logs` ที่เก่ากว่า **180 วัน** ทีละ 5,000 แถว — นานกว่า event เพราะตาราง "ผลการส่ง" ของ
     workflow นับจาก log นี้ (ตัวเลขในหน้าผลลัพธ์จะเป็นของ 180 วันล่าสุด)
  4. log หนึ่งบรรทัด: จำนวนแถวที่ลบ, แถวคงเหลือ, `pg_total_relation_size`
- system health (`health.report`) เพิ่ม `marketingEvents: { rows, totalBytes, oldestAt, rejectedLast24h }`
- ประมาณขนาดเก็บ 90 วัน: ตอนนี้ ~10 MB · มือถือ + โต 10 เท่า ~150 MB · โต 100 เท่า ~1 GB
- ponytail: DELETE เป็น batch พอที่ปริมาณนี้ — เปลี่ยนเป็น partition รายเดือน (drop partition) เมื่อเกิน ~10 ล้านแถว

## 13. ฝั่ง josh (เพิ่มอย่างเดียว, ปิดเป็นค่าเริ่มต้น)

- outbox trigger บน `user_devices`: `AFTER INSERT OR UPDATE OF user_id ... WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)`
  (INSERT ทุกแถว) → แถว `device.snapshot` ใน `commerce_outbox` · ทำตามแบบ trigger ของ snapshot อื่นใน stage 0
- snapshot builder: `{ individualId, userId, platform }` · `device.deleted` ไม่มี (josh ไม่ลบแถว)
- backfill หนึ่งครั้ง: แถว `user_devices` ทั้งหมดผ่าน `POST /api/reports/order-copy/backfill` แบบเดียวกับ snapshot อื่น
- ไม่แตะ `analytics_events` / `marketing_page_view` / workflow ของ josh

## 14. Client

**shop-web** (`lib/analytics.ts`): `track()` ส่งเข้า commerce เพิ่ม (ยังส่ง josh ต่อ) ถ้ามี `NEXT_PUBLIC_COMMERCE_EVENTS_URL`
- ใช้ device id ตัวเดียวกับที่ส่ง josh (`ensureDeviceId()`) · `eventId = crypto.randomUUID()`
- รวม event เป็น batch ทุก 2 วินาที หรือครบ 20 ตัว · ส่งด้วย `fetch(..., { keepalive: true })`, ตอนปิดหน้าใช้ `sendBeacon`
- fire-and-forget: timeout 3 วินาที, ไม่ retry, error ไม่ขึ้นหน้าเว็บ · ส่งเฉพาะชื่อที่อยู่ใน seed catalog

**มือถือ (contract ให้ทีมมือถือ ไม่แก้ในก้อนนี้):** เส้นเดียวกัน `POST /api/events`, `platform: 'ios' | 'android'`,
`deviceId` = OneSignal subscription id ตัวเดียวกับที่ส่ง `POST /auth/device` ของ josh, batch / fire-and-forget แบบเดียวกัน

## 15. Error handling

| สถานการณ์ | ผล |
|---|---|
| commerce ล่ม / ช้า | client ทิ้ง event ช่วงนั้น · ร้านค้าทำงานปกติ |
| ingest ปิด | `503 ingest_disabled` · client ทิ้งเงียบ |
| event ไม่มี user (guest / link ยังไม่มา) | เก็บไว้ `user_id NULL` · ไม่ trigger · เติมทีหลังตอน link (§5) |
| job `marketing-event` ล้ม | BullMQ retry · enroll ไม่ซ้ำ (`UNIQUE (workflow_id, user_id, occurrence_key)`) |
| event แข่งกับ timeout ของ wait_event | ล็อกแถว ใครก่อนได้ไป (§7) |
| workflow pause ระหว่างรอ event | เหมือน wait เดิม (enrollment ค้างจนกลับมา active) |
| event ถูก archive ขณะ workflow ใช้ | ทำไม่ได้ (`409`) |
| `customer.deleted` (PDPA) | ทรานแซกชันเดียวกับ PDPA เดิม: ลบ `marketing_events` และ `marketing_device_links` ของ user |

## 16. การทดสอบ

- Unit: validator ของ catalog (ชื่อ, ชนิด, PII), `event-filter.ts` ทุก op/ชนิด, การหา user จาก link (guest → A → B, link มาไม่เรียง),
  compiler ของ segment rule event (SQL + params), validator workflow ใหม่ (คูปองต้องมี cooldown, อ้าง event ที่ไม่มี)
- DB: ingest (accepted / duplicate / rejected แต่ละ reason), merge ตอน link, trigger enroll ครั้งเดียวต่อ event,
  wait_event ทั้ง matched / timeout / แข่งกัน, goal event, retention ทีละ batch + rollup, PDPA
- josh: trigger ของ `user_devices` ยิงตอน insert และตอน `user_id` เปลี่ยนเท่านั้น (save ซ้ำค่าเดิมไม่ยิง)
- shop-web: `track()` ส่งทั้งสองทาง, commerce error / timeout ไม่ throw
- Browser (localhost, test DB): สร้าง event ใน catalog → workflow `add_to_cart` → wait `purchase` → หมดเวลา → notify tester ·
  segment "add_to_cart ≥ 1 ใน 7 วัน" ได้คนที่ถูก

## 17. Rollout (ต้องเรียงลำดับ)

1. deploy commerce-platform + migration (seed catalog) · `MARKETING_EVENTS_INGEST_ENABLED` ยังปิด
2. deploy josh (trigger `user_devices`, ปิด) → เปิด → เพิ่ม `device.snapshot` ใน subscription
   (`SCRIPT_ARGS='add=device.snapshot'` กับ `ops/scripts/josh-subscription.cjs`) → backfill `user_devices`
3. เปิด ingest · เพิ่มโดเมน shop ใน `COMMERCE_CORS_ORIGINS` · deploy shop-web พร้อม `NEXT_PUBLIC_COMMERCE_EVENTS_URL`
4. deploy commerce-admin · รันทดสอบกับ tester ก่อน activate workflow จริง
5. ส่ง contract (§14) ให้ทีมมือถือ
