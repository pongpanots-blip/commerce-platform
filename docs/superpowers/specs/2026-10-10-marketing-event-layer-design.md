# ชั้น Event ของ marketing workflow (ก้อน 1/4 ของการเติมช่องว่างเทียบ Pushwoosh) — design

อ้างอิง: `docs/research/2026-10-10-pushwoosh-deep-dive.md` (ส่วน "เทียบกับ marketing workflow phase 1"),
`docs/superpowers/specs/2026-10-10-marketing-workflow-builder-design.md` (phase 1)

## 1. เป้าหมาย ขอบเขต

commerce เป็นเจ้าของข้อมูลพฤติกรรมลูกค้า (event) เอง เพื่อลด load ของ josh และเป็น hub ให้แพลตฟอร์มอื่นในอนาคต
แล้วใช้ event นั้นใน workflow แบบ Pushwoosh

**ก้อนนี้มี:**
1. Ingest API เส้นเดียว `POST /api/events` — shop-web และมือถือยิงเส้นเดียวกัน
2. Event catalog (admin นิยาม event + attribute ชนิด string / number / boolean / date)
3. ผูก device → user ด้วย device id (แบบ HWID) จาก `user_devices` ของ josh และ merge event ทุกตัวเข้ากับ user
4. Trigger แบบ `event` + เงื่อนไข attribute
5. Step `wait_event` (Wait for event + timeout, ทางออก "เกิดขึ้น" / "หมดเวลา")
6. Goal แบบ event
7. จับคู่ attribute ข้าม event (เงื่อนไขอ้างค่าจาก event ที่ trigger)
8. Segment rule ตาม event: จำนวนครั้ง หรือผลรวมของ attribute ในช่วงเวลา ที่ attribute ตรง
9. Journey ของ guest (ยังไม่ login): trigger ด้วย event ของ device, ส่ง push ไปที่ device, รับช่วงเป็นของ user ตอน login
10. ตัวแปร `{{event.<key>}}` ใน notify / webhook
11. หน้า admin "Events" + เก็บข้อมูลแบบไม่บวม (partition รายเดือน, อายุ 90 วัน, สรุปรายวัน)
12. shop-web ส่ง event เข้า commerce (ส่งเข้า josh ต่อด้วยจนถึง phase 3) · contract สำหรับมือถือ

**ก้อนถัดไป (spec แยก):** 2) สถิติบน canvas · 3) polish editor (autosave, stop) · 4) content editor

**ไม่อยู่ในก้อนนี้:** แก้แอปมือถือ (ให้ contract ไป), segment ของ guest, email / in-app / คูปองถึง guest (ไม่มีตัวตนให้ส่ง),
archive ไป S3, ย้าย workflow ของ josh มา commerce (phase 3)

## 2. ข้อมูลที่มีอยู่แล้ว

- josh → commerce: snapshot ผ่าน outbox (`POST /internal/josh-events`, HMAC, version guard ต่อ aggregate) — ไม่มี event พฤติกรรม
- josh เก็บพฤติกรรมเอง: `analytics_events` (allowlist: view_item, add_to_cart, search, begin_checkout, purchase, login …),
  `marketing_page_view`, cart idle — shop-web `lib/analytics.ts` `track()` ยิง josh · มือถือยิงแค่ GTM dataLayer
- josh `user_devices`: `individual_id` (unique) → `user_id`, `platform`, อัปเดตตอน login และ `POST /auth/device`
  (web = device id ของ shop-web, mobile = OneSignal subscription id)
- josh push: `OneSignalClient.sendToExternalUser` ส่งหา `external_id = userId` เท่านั้น · shop-web มี OneSignal web SDK
  (`lib/onesignal.ts`, `OneSignal.login(userId)`)
- commerce: Postgres + Redis/BullMQ · `Throttle` (express-rate-limit ต่อ IP) · `@Public()` · CORS จาก `COMMERCE_CORS_ORIGINS`
- ปริมาณ (shop_traffic 2026-09-11 → 10-10): ~8,000 event/เดือน, web อย่างเดียว

## 3. Ingest API

`POST /api/events` · `@Public()` · ปิดด้วย `MARKETING_EVENTS_INGEST_ENABLED` (ปิด → `503 { code: 'ingest_disabled' }`, client ทิ้งเงียบ)

```jsonc
// request
{ "deviceId": "uuid", "platform": "web" | "ios" | "android",
  "pushSubscriptionId": "uuid",            // ไม่บังคับ — OneSignal subscription id ของ device (ถ้าเปิดรับ push)
  "events": [ { "eventId": "uuid", "name": "add_to_cart", "occurredAt": "ISO-8601", "attributes": { "product_id": "SKU-1", "price": 199.5 } } ] }
// response 200
{ "results": [ { "eventId": "uuid", "status": "accepted" | "duplicate" | "rejected", "reason": "unknown_event" } ] }
```

- `events` 1–20 ตัว · body ≤ 32 KB · zod strict ทั้ง envelope (envelope เสีย → `400`)
- ต่อ event (เสียตัวไหน reject ตัวนั้น ตัวอื่นยังรับ):
  - `name` ต้องอยู่ใน catalog และ `status = active` → ไม่งั้น `unknown_event` / `archived_event`
  - attribute: เก็บเฉพาะ key ที่ประกาศ (ที่ไม่ประกาศตัดทิ้งเงียบ), ชนิดต้องตรง → ไม่งั้น `bad_attribute_type`
    (date = ISO-8601 ที่ parse ได้ เก็บเป็น ISO UTC); ≤ 20 key และ JSON ≤ 2 KB → ไม่งั้น `too_large`
  - `occurredAt` ไม่เกินอนาคต 5 นาที (`in_future`) และไม่เก่ากว่า 7 วัน (`too_old`)
  - `(eventId, occurredAt)` ซ้ำ → `duplicate` (`ON CONFLICT DO NOTHING`; client ส่งซ้ำด้วยค่าเดิมทั้งคู่)
- Rate limit: `@Throttle` 120 request/นาที ต่อ IP + 60 event/นาที ต่อ `deviceId` (express-rate-limit memory store, key = deviceId)
  → `429` · ponytail: memory store ต่อ instance — เปลี่ยนเป็น Redis store ถ้ารัน commerce-platform มากกว่า 1 instance
- CORS: เพิ่มโดเมน shop ใน `COMMERCE_CORS_ORIGINS` (มือถือไม่ติด CORS)
- ในทรานแซกชันเดียว: upsert `marketing_devices` (§4; เขียนเฉพาะเมื่อ `push_subscription_id` / `platform` เปลี่ยน หรือ
  `last_seen_at` เก่ากว่า 1 ชม.) + insert event ที่ผ่าน + ใส่ `user_id` จาก link (§5) · หลัง commit enqueue job
  `marketing-event` (`{ eventIds }`) ไปทำ trigger / wait / goal (§6–9) — request ไม่รอ
- ไม่ log ราย request · log เฉพาะ error และตัวเลขรวม (accepted / duplicate / rejected ตาม reason) ทุก 5 นาที

## 4. ตาราง (migration ใหม่)

| ตาราง | คอลัมน์ | index / หมายเหตุ |
|---|---|---|
| `marketing_event_definitions` | `name varchar(64) PK` (`^[a-z][a-z0-9_]{1,63}$`), `label`, `description`, `attributes jsonb` (`[{ key, type: 'string'\|'number'\|'boolean'\|'date', label }]`), `status` (`active`/`archived`), `created_at`, `updated_at` | seed: `view_item`, `view_category`, `search`, `add_to_cart`, `begin_checkout`, `purchase`, `login` (attribute ตาม `lib/analytics-events.ts` ของ shop-web) |
| `marketing_events` | `id bigint` (identity), `event_id uuid`, `device_id uuid NOT NULL`, `user_id uuid NULL`, `platform varchar(10)`, `name varchar(64)`, `attributes jsonb`, `occurred_at timestamptz NOT NULL`, `received_at timestamptz default now()` | **`PARTITION BY RANGE (occurred_at)` รายเดือน** (§13) · `PK (id, occurred_at)` · `UNIQUE (event_id, occurred_at)` · `(user_id, name, occurred_at) WHERE user_id IS NOT NULL` · `(device_id, occurred_at)` |
| `marketing_devices` | `device_id uuid PK`, `platform varchar(10)`, `push_subscription_id uuid NULL`, `first_seen_at`, `last_seen_at` | ข้อมูลส่ง push ถึง guest (§10) |
| `marketing_device_links` | `id bigserial PK`, `device_id uuid`, `user_id uuid`, `platform varchar(10)`, `linked_at timestamptz` | `UNIQUE (device_id, linked_at)` · `(user_id)` |
| `marketing_event_daily` | `date date`, `name`, `platform`, `events int`, `users int`, `devices int` | `PK (date, name, platform)` เก็บถาวร |
| `marketing_workflow_enrollments` (แก้) | `user_id` เป็น `NULL` ได้ · เพิ่ม `device_id uuid NULL`, `waiting_for jsonb NULL` (`{ stepId, eventName, filters, since }`), `trigger_event jsonb NULL` (`{ eventId, name, attributes }`) | `CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)` · unique เดิม `(workflow_id, user_id, occurrence_key)` + ใหม่ `UNIQUE (workflow_id, device_id, occurrence_key) WHERE user_id IS NULL` · `(device_id) WHERE user_id IS NULL AND status IN ('pending','running')` |
| `marketing_guest_push_log` | `device_id uuid`, `sent_at timestamptz` | `(device_id, sent_at)` · ใช้นับเพดาน guest push (§10) · ลบตามอายุ 7 วัน |

- `marketing_workflows.trigger_type` ไม่มี CHECK อยู่แล้ว — เพิ่ม `'event'` ที่ zod / types
- ต้องใช้ Postgres ≥ 12 (unique index บนตาราง partition) — ตรวจเวอร์ชันของ prod ตอนเขียน plan

## 5. Device link และการ merge event เข้ากับ user

**ที่มา:** josh ส่ง `device.snapshot` ผ่าน outbox เดิม `{ individualId, userId, platform }` (aggregateId = `user_devices.id`)
เฉพาะตอน `user_id` ของแถวเปลี่ยน (รวมแถวใหม่) · `linked_at` = `occurredAt` ของ envelope

**commerce รับ `device.snapshot`** (ใน `josh-events.service.ts`, ทรานแซกชันเดียวกับ version guard เดิม):
1. insert `marketing_device_links (device_id, user_id, platform, linked_at)` — ถ้า link ล่าสุดก่อนหน้า `linked_at` ของ device นี้เป็น user เดิมอยู่แล้ว → ไม่ insert
2. หาช่วงที่ link นี้ครอบ: `start` = `linked_at` (ถ้าไม่มี link ก่อนหน้าของ device → `-∞`), `end` = `linked_at` ของ link ถัดไป (ไม่มี → `∞`)
3. `UPDATE marketing_events SET user_id = :user WHERE device_id = :device AND occurred_at >= :start AND occurred_at < :end`
4. รับช่วง journey ของ guest: enrollment `pending` / `running` ที่ `device_id = :device AND user_id IS NULL` → `user_id = :user`
   (ถ้า user มี enrollment ของ workflow + `occurrence_key` เดียวกันอยู่แล้ว → ตัวของ guest จบเป็น `skipped: merged`)
5. หลัง commit: enqueue `marketing-event` ของ event ที่ถูกเติม user และ `occurred_at ≥ now − 60 นาที`
   (trigger ทำซ้ำได้ปลอดภัยเพราะ `occurrence_key = event_id` และขั้น 4 ทำก่อน)

**ตอน ingest:** `user_id` = user ของ link ล่าสุดที่ `linked_at ≤ occurred_at` · ไม่มี → user ของ link แรกของ device · ไม่มี link เลย → `NULL`

**กติกา (ตัวอย่าง device D: guest → login A → login B):** event ตอน guest และช่วง A → A · หลัง login B → B ·
link มาถึงช้ากว่า event หรือมาไม่เรียงก็ได้ผลเดียวกัน เพราะคำนวณจากช่วงเวลาทุกครั้ง · ทุก event เก็บ `device_id` เสมอ
(ดูได้ทั้ง device → user และ user → ทุก device)

**ข้อจำกัดที่รับได้:** josh ไม่ unlink ตอน logout → event หลัง logout บน device ร่วมนับเป็นของคนล่าสุด

## 6. Filter ของ attribute (ใช้ร่วมกันทุกที่)

`filters: [{ key, op, value }]` (AND กัน, ≤ 10) · ตัวประเมินเป็น pure function เดียว `domain/event-filter.ts`
(`matches(attributes, filters, triggerAttributes?)`) · key / ชนิดตรวจกับ catalog ตอน validate

| ชนิด | op | value |
|---|---|---|
| string | `eq`, `neq`, `contains`, `in` (≤ 50 ค่า) | ค่า หรือ `{ fromTrigger: key }` (เฉพาะ `eq` / `neq`) |
| number | `eq`, `neq`, `gt`, `gte`, `lt`, `lte` | ค่า หรือ `{ fromTrigger: key }` |
| boolean | `eq` | ค่า หรือ `{ fromTrigger: key }` |
| date | `before`, `after` (ISO) · `within_last_days`, `within_next_days` (1–365, เทียบกับเวลาที่ประเมิน) | ค่า หรือ `{ fromTrigger: key }` (เฉพาะ `before` / `after`) |

**จับคู่ข้าม event (`fromTrigger`):** ค่ามาจาก `trigger_event.attributes[key]` ของ enrollment เช่น wait `purchase` ที่
`order_id eq { fromTrigger: 'order_id' }` · ใช้ได้ใน `wait_event` และ goal เท่านั้น และเฉพาะ workflow ที่ trigger เป็น `event` ·
validator: key ต้องมีใน attribute ของ event ที่ trigger และชนิดตรงกัน · ตอนรัน ถ้า trigger event ไม่มีค่านั้น → filter ไม่ผ่าน

## 7. Trigger `event`

`trigger_config = { eventName, filters, includeGuests: boolean }` (filters ห้าม `fromTrigger`)

- job `marketing-event` ต่อ event ที่ `occurred_at ≥ now − 60 นาที` (`TRIGGER_RECENT_MINUTES` เดิม): workflow ที่ `active`,
  `trigger_type = 'event'`, `eventName` ตรง, filters ผ่าน →
  - event มี `user_id` → `engine.enroll(wf, { userId }, occurrenceKey = event_id)`
  - ไม่มี `user_id` และ `includeGuests` → `engine.enroll(wf, { deviceId }, occurrenceKey = event_id)` (§10)
  - ไม่มี `user_id` และไม่ `includeGuests` → ข้าม (link มาทีหลังภายใน 60 นาทีจะ enroll ให้ตาม §5)
  - `trigger_event = { eventId, name, attributes }`
- gate เดิมทั้งหมด (schedule, cooldown, audience, holdout) · นับเฉพาะ event หลัง `activated_at` · cooldown ของ guest นับต่อ device

## 8. Step `wait_event`

```ts
{ id, type: 'wait_event', eventName, filters, timeoutHours, timeoutMinutes?, matchedNextId, timeoutNextId }
```

- timeout รวม ≤ 30 วัน (`LIMITS.maxWaitMinutes`) · นับรวมกับ `maxWaitSteps` (3) เดียวกับ `wait`
- ถึง step: `waiting_for = { stepId, eventName, filters, since: now }`, `resume_at = now + timeout`, park แบบ `wait` เดิม
- job `marketing-event`: หา enrollment `running` ที่ `waiting_for->>'eventName' = name` และ
  (`user_id = event.user_id` หรือ `user_id IS NULL AND device_id = event.device_id`) และ `occurred_at ≥ since` →
  filters ผ่าน (พร้อม `trigger_event.attributes`) → ล็อกแถว (`FOR UPDATE`), เช็กว่า `waiting_for.stepId` ยังเป็น step ปัจจุบัน →
  ล้าง `waiting_for`, `current_step_id = matchedNextId`, `queue.step` ทันที · action log `wait_event` (`meta: { matched: true, eventId }`)
- ครบเวลา: sweep / delayed job เดิม → `walk()` เห็น `waiting_for` ยังอยู่ → ล้าง, เดิน `timeoutNextId` · log `{ matched: false }`
- แข่งกัน (event มาพร้อม timeout): ทั้งสองทางล็อกแถว ใครก่อนได้ไป อีกทางเห็น `waiting_for` ว่าง / step เปลี่ยน → ข้าม
- tester `skipWaits`: ถือว่าหมดเวลาทันที (เดิน `timeoutNextId`)
- `nextIdsOf`: `wait_event` → `[matchedNextId, timeoutNextId]`

## 9. Goal แบบ event

`exit_on_goal = { kind: 'order_placed' } | { kind: 'event', eventName, filters }`

- เช็กก่อน action / webhook ทุกตัว (เหมือนเดิม): ดึง event ชื่อ goal ของ user (หรือ device ถ้ายังเป็น guest) ที่
  `occurred_at ≥ started_at` แล้วประเมินด้วย `event-filter.ts` → ผ่านตัวใดตัวหนึ่ง → `skipped: goal_reached`
- conversion: job `marketing-event` → enrollment ที่ goal ตรง, `started_at` อยู่ใน `conversion_window_days`, ยังไม่มี
  `converted_at` → ตั้ง `converted_at` (goal `order_placed` ใช้ทาง `order.snapshot` เดิม)

## 10. Journey ของ guest

- เปิดต่อ workflow ด้วย `trigger_config.includeGuests` (เฉพาะ trigger `event`)
- validator ของ workflow ที่ `includeGuests`: ห้ามมี node Audience, condition `segment.in` / `user.*` / `still_no_order`
  (segment และข้อมูล user ไม่มีสำหรับ guest) — ไม่งั้น activate ไม่ได้
- ระหว่างเป็น guest (`user_id IS NULL`):
  - notify: ส่งได้เฉพาะ `push` และ device ต้องมี `push_subscription_id` → `marketing.notify` แบบ
    `target: { kind: 'device', subscriptionId, platform }` · ช่องทางอื่น / ไม่มี subscription → action log `skipped: guest_channel`
  - แจกคูปอง → `skipped: guest_no_user` (เดินต่อ step ถัดไป)
  - webhook ส่งได้ · ตัวแปร `{{device.id}}`, `{{device.platform}}` (user ว่าง)
  - เพดาน: push ถึง guest ไม่เกิน 1 ครั้ง / device / 24 ชม. รวมทุก workflow (`GUEST_PUSH_DAILY_CAP = 1`, นับจาก
    `marketing_guest_push_log`) เกิน → `skipped: guest_cap` · ponytail: เพดานคงที่ — ย้ายไปรวมกับ frequency cap ของระบบใน phase 3
- login ระหว่างทาง → enrollment ถูกรับช่วงเป็นของ user (§5 ข้อ 4) · step ถัดไปส่งได้ทุกช่องทางตามปกติ และ gate ของ user
  (frequency cap ของ josh, opt-out) ทำงานตามเดิม
- analytics: นับ guest แยก (`enrolledGuests`, `mergedToUser`)

## 11. Segment rule ตาม event

leaf ใหม่ใน `segment-definition.compiler.ts`:

```ts
{ field: 'event', event: { name, measure: 'count' | { sum: key }, op: 'gte' | 'eq' | 'lte', value,
  window: { lastDays } | { from, to }, filters } }
```

- compile เป็น `(SELECT <count(*) | COALESCE(SUM((e.attributes->>$k)::numeric), 0)> FROM marketing_events e
  WHERE e.user_id = <user id ของ query> AND e.name = $n AND e.occurred_at >= $n [AND e.occurred_at < $n] AND <filters>) <op> $n`
  — ทุกค่าเป็น parameter, key ตรวจกับ catalog, number cast `::numeric`, date cast `::timestamptz`
- `sum` ใช้ได้เฉพาะ attribute ชนิด number · `count` value 0–1000 (`eq 0` = "ไม่เคยทำ") · `sum` value เป็นตัวเลขใดก็ได้
- `lastDays` 1–90 · `from`/`to` ต้องอยู่ใน 90 วันล่าสุด · filters ห้าม `fromTrigger`
- ใช้ร่วม AND/OR กับ leaf อื่นได้ · ใช้ได้ทุกที่ที่ใช้ segment: node Audience, `segment.in`, scheduled, `userMatchesSegment`
- ตัวสร้าง segment ใน admin: เพิ่มชนิด rule "Event" (เลือก event, นับครั้ง / ผลรวมของ attribute, ช่วงเวลา, เงื่อนไข attribute)

## 12. ตัวแปร event ในข้อความ

- notify: `data.event = trigger_event.attributes` ส่งไปกับ `marketing.notify` (template ของ josh ใช้ได้)
- webhook: ตัวแปร `{{event.<key>}}`, `{{event.name}}`, `{{device.id}}`, `{{device.platform}}` ใน `webhookVars`
  (escape ตาม `template.ts` เดิม)
- workflow ที่ไม่ได้มาจาก event: ตัวแปร event ว่าง · validator เตือนถ้าใช้ `{{event.*}}` ใน workflow ที่ trigger ไม่ใช่ `event`

## 13. เก็บข้อมูลแบบไม่บวม

**Partition:** `marketing_events` เป็น `PARTITION BY RANGE (occurred_at)` รายเดือน (`marketing_events_YYYY_MM`, เวลา UTC)
+ partition `marketing_events_default` กันพลาด · migration สร้างตารางแม่ + partition เดือนปัจจุบัน + 2 เดือนถัดไป
(raw SQL — TypeORM entity ชี้ตารางแม่ใช้ query ได้ตามปกติ แต่ไม่ให้ `synchronize` จัดการ)

**job รายคืน 03:00 Asia/Bangkok** (BullMQ repeatable บนคิว `marketing-workflow`):
1. สร้าง partition ล่วงหน้าให้ครบเดือนปัจจุบัน + 2 เดือนถัดไป (`CREATE TABLE IF NOT EXISTS ... PARTITION OF`)
2. upsert `marketing_event_daily` ของเมื่อวาน (นับซ้ำได้ ผลเท่าเดิม)
3. `DROP` partition ที่ขอบบนเก่ากว่า `now − 90 วัน` (ทั้งก้อน ไม่มี bloat) · ข้อมูลจึงอยู่ 90–120 วัน แต่ segment / UI
   ใช้แค่ 90 วันล่าสุด
4. ลบ `marketing_workflow_action_logs` ที่เก่ากว่า **180 วัน** ทีละ 5,000 แถว — นานกว่า event เพราะตาราง "ผลการส่ง" ของ
   workflow นับจาก log นี้ (ตัวเลขในหน้าผลลัพธ์จะเป็นของ 180 วันล่าสุด) · ลบ `marketing_guest_push_log` ที่เก่ากว่า 7 วัน
5. log หนึ่งบรรทัด: partition ที่สร้าง / drop, แถวคงเหลือ, `pg_total_relation_size`, แถวใน default partition

- default partition มีแถว = job สร้าง partition พลาด → system health แจ้ง · job ย้ายแถวเข้า partition ที่ถูกต้องในรอบถัดไป
  (detach default → สร้าง partition → insert กลับ → attach)
- system health (`health.report`) เพิ่ม `marketingEvents: { rows, totalBytes, oldestAt, defaultPartitionRows, rejectedLast24h }`
- ประมาณขนาดเก็บ 90 วัน: ตอนนี้ ~10 MB · มือถือ + โต 10 เท่า ~150 MB · โต 100 เท่า ~1 GB

## 14. Admin

**API (staff auth + role marketing เดิม):**
`GET/POST /api/marketing/events/definitions`, `PUT /api/marketing/events/definitions/:name`,
`POST /api/marketing/events/definitions/:name/archive`, `GET /api/marketing/events?deviceId&userId&name&page`,
`GET /api/marketing/events/daily?from&to`

**กฎ catalog:**
- `name` และ `type` ของ attribute แก้ไม่ได้หลังสร้าง · เพิ่ม attribute ได้ · ลบ = archive
- archive event หรือ attribute ที่ workflow `active` ใช้อยู่ (trigger / wait_event / goal / filters / `fromTrigger`) หรือ segment
  ใช้อยู่ → `409` พร้อมรายชื่อที่ใช้
- ชื่อ attribute ที่เข้าข่าย PII ถูกปฏิเสธ: `email`, `phone`, `tel`, `mobile`, `name`, `first_name`, `last_name`, `address`,
  `id_card`, `citizen_id`, `password`, `token` (เทียบแบบไม่สนตัวพิมพ์ และ `_` / `-`)

**หน้า `/marketing/events`:** ตาราง catalog + ฟอร์มสร้าง/แก้ · แท็บ "Event ล่าสุด" (ค้นด้วย device / user / ชื่อ) ·
แท็บ "รายวัน" (ตารางจาก `marketing_event_daily`) · คำเตือนห้ามประกาศ PII

**Editor workflow:**
- palette ENTRY เพิ่ม "Event" · FLOW เพิ่ม "Wait for event" (การ์ด 2 ทางออก: เกิดขึ้น / หมดเวลา)
- ฟอร์ม trigger (มีสวิตช์ "รวม guest") / wait_event / goal: เลือก event จาก catalog, filter ที่ช่องค่าเปลี่ยนตามชนิด,
  ช่องค่าเลือก "ค่าจาก event ที่ trigger" ได้ (wait_event / goal)
- รันทดสอบ: workflow ที่ trigger เป็น `event` ใส่ attribute ตัวอย่างได้ (`testRunSchema` เพิ่ม `eventAttributes?`)
- validator ใหม่:
  - trigger `event` + มี node แจกคูปอง → ต้อง `cooldown_days ≥ 1` (ไม่งั้น activate ไม่ได้) และเตือนให้ใช้ trigger
    ฝั่ง server (order milestone) สำหรับคูปองมูลค่าสูง — event จาก client ผู้ใช้ปลอมให้ตัวเองได้
  - event / attribute ที่อ้างถึงต้องอยู่ใน catalog และ `active` · `fromTrigger` ตาม §6 · `includeGuests` ตาม §10

## 15. ฝั่ง josh (เพิ่มอย่างเดียว, ปิดเป็นค่าเริ่มต้น)

- outbox trigger บน `user_devices`: `AFTER INSERT OR UPDATE OF user_id ... WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)`
  (INSERT ทุกแถว) → แถว `device.snapshot` ใน `commerce_outbox` · ทำตามแบบ trigger ของ snapshot อื่นใน stage 0
- snapshot builder: `{ individualId, userId, platform }` · `device.deleted` ไม่มี (josh ไม่ลบแถว)
- backfill หนึ่งครั้ง: แถว `user_devices` ทั้งหมดผ่าน `POST /api/reports/order-copy/backfill` แบบเดียวกับ snapshot อื่น
- `marketing.notify` รับ `target: { kind: 'device', subscriptionId, platform }` เพิ่ม (เดิมเป็น user):
  `OneSignalClient.sendToSubscription` ใหม่ (`include_subscription_ids`, app หลัก, category `marketing`) · push เท่านั้น ·
  render template โดยตัวแปรของ user ว่าง · ไม่ผ่าน frequency cap ของ josh (commerce คุมเพดาน guest เอง §10)
- ไม่แตะ `analytics_events` / `marketing_page_view` / workflow ของ josh

## 16. Client

**shop-web** (`lib/analytics.ts`): `track()` ส่งเข้า commerce เพิ่ม (ยังส่ง josh ต่อ) ถ้ามี `NEXT_PUBLIC_COMMERCE_EVENTS_URL`
- ใช้ device id ตัวเดียวกับที่ส่ง josh (`ensureDeviceId()`) · `eventId = crypto.randomUUID()`
- `pushSubscriptionId` = `OneSignal.User.PushSubscription.id` ถ้าเปิดรับ push (`lib/onesignal.ts`)
- รวม event เป็น batch ทุก 2 วินาที หรือครบ 20 ตัว · ส่งด้วย `fetch(..., { keepalive: true })`, ตอนปิดหน้าใช้ `sendBeacon`
- fire-and-forget: timeout 3 วินาที, ไม่ retry, error ไม่ขึ้นหน้าเว็บ · ส่งเฉพาะชื่อที่อยู่ใน seed catalog

**มือถือ (contract ให้ทีมมือถือ ไม่แก้ในก้อนนี้):** เส้นเดียวกัน `POST /api/events`, `platform: 'ios' | 'android'`,
`deviceId` = `pushSubscriptionId` = OneSignal subscription id ตัวเดียวกับที่ส่ง `POST /auth/device` ของ josh,
batch / fire-and-forget แบบเดียวกัน

## 17. Error handling

| สถานการณ์ | ผล |
|---|---|
| commerce ล่ม / ช้า | client ทิ้ง event ช่วงนั้น · ร้านค้าทำงานปกติ |
| ingest ปิด | `503 ingest_disabled` · client ทิ้งเงียบ |
| event ไม่มี user | เก็บไว้ `user_id NULL` · trigger แบบ guest ถ้า workflow เปิด · เติม user ทีหลังตอน link (§5) |
| job `marketing-event` ล้ม | BullMQ retry · enroll ไม่ซ้ำ (unique ทั้งแบบ user และแบบ device) |
| event แข่งกับ timeout ของ wait_event | ล็อกแถว ใครก่อนได้ไป (§8) |
| guest login ระหว่าง journey | รับช่วงเป็นของ user ใน transaction ของ link (§5) |
| ส่ง push ถึง guest ไม่สำเร็จ / subscription หมดอายุ | josh ตอบ fail → action log `failed` · เดิน step ถัดไปตามเดิม |
| job สร้าง partition พลาด | แถวลง default partition · health แจ้ง · รอบถัดไปย้ายให้ (§13) |
| workflow pause ระหว่างรอ event | เหมือน wait เดิม (enrollment ค้างจนกลับมา active) |
| event ถูก archive ขณะ workflow ใช้ | ทำไม่ได้ (`409`) |
| `customer.deleted` (PDPA) | ทรานแซกชันเดียวกับ PDPA เดิม: ลบ `marketing_events` และ `marketing_device_links` ของ user, ลบ `marketing_devices` / `marketing_guest_push_log` ของ device ที่เคย link กับ user นั้น |

## 18. ความปลอดภัย

- endpoint สาธารณะ: zod strict, UUID ทุก id, body ≤ 32 KB, ชนิด attribute ตาม catalog, rate limit ต่อ IP + device, CORS เฉพาะ shop
- `occurredAt` ถูกจำกัดช่วง (อนาคต ≤ 5 นาที, ย้อนหลัง ≤ 7 วัน) กันยิงย้อนหลังปั่น segment
- event จาก client ผู้ใช้ปลอมให้ตัวเองได้ → คูปองจาก trigger `event` ต้องมี cooldown (§14)
- ปลอม `deviceId` / `pushSubscriptionId` ของคนอื่นต้องรู้ UUID ของเขา (ไม่เปิดเผย) · ผลเสียสูงสุดคือ push ถึง device นั้น
  ไม่เกิน 1 ครั้ง / วัน (§10)
- ห้าม PII ใน catalog (§14) · admin API ใช้ staff auth + role marketing เดิม

## 19. การทดสอบ

- Unit: validator ของ catalog (ชื่อ, ชนิด, PII), `event-filter.ts` ทุก op / ชนิด รวม date และ `fromTrigger`, การหา user จาก link
  (guest → A → B, link มาไม่เรียง), compiler ของ segment rule event (count / sum, SQL + params), validator workflow ใหม่
  (คูปองต้องมี cooldown, อ้าง event ที่ไม่มี, `fromTrigger` ชนิดไม่ตรง, `includeGuests` กับ Audience)
- DB: ingest (accepted / duplicate / rejected แต่ละ reason), merge ตอน link, trigger enroll ครั้งเดียวต่อ event (user และ guest),
  guest → login รับช่วง, wait_event ทั้ง matched / timeout / แข่งกัน / `fromTrigger`, goal event, partition (สร้างล่วงหน้า,
  drop, default แล้วย้าย), rollup, เพดาน guest push, PDPA
- josh: trigger ของ `user_devices` ยิงตอน insert และตอน `user_id` เปลี่ยนเท่านั้น (save ซ้ำค่าเดิมไม่ยิง) ·
  `marketing.notify` แบบ device เรียก OneSignal ด้วย `include_subscription_ids`
- shop-web: `track()` ส่งทั้งสองทาง, แนบ `pushSubscriptionId` เมื่อมี, commerce error / timeout ไม่ throw
- Browser (localhost, test DB): สร้าง event ใน catalog → workflow `add_to_cart` → wait `purchase` ที่ `order_id` ตรง →
  หมดเวลา → notify tester · segment "add_to_cart ≥ 1 ใน 7 วัน" และ "ผลรวม price ≥ 500" ได้คนที่ถูก ·
  guest journey ด้วย device ที่ยังไม่ login แล้ว login กลางทาง

## 20. Rollout (ต้องเรียงลำดับ)

1. deploy commerce-platform + migration (partition, seed catalog) · `MARKETING_EVENTS_INGEST_ENABLED` ยังปิด
2. deploy josh (trigger `user_devices` ปิด, `marketing.notify` แบบ device) → เปิด trigger → เพิ่ม `device.snapshot`
   ใน subscription (`SCRIPT_ARGS='add=device.snapshot'` กับ `ops/scripts/josh-subscription.cjs`) → backfill `user_devices`
3. เปิด ingest · เพิ่มโดเมน shop ใน `COMMERCE_CORS_ORIGINS` · deploy shop-web พร้อม `NEXT_PUBLIC_COMMERCE_EVENTS_URL`
4. deploy commerce-admin · รันทดสอบกับ tester ก่อน activate workflow จริง · ลอง guest journey กับ device ทดสอบก่อนเปิด
   `includeGuests` ใน workflow จริง
5. ส่ง contract (§16) ให้ทีมมือถือ
