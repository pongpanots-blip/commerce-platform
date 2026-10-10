# Marketing workflow ของ commerce — เฟส 1: engine + editor ลากวาง + Webhook + A/B split — design

> สถานะ: อนุมัติ design ในแชตแล้ว (2026-10-10) · ขั้นถัดไป: implementation plan
> ที่มา: user ต้องการ editor แบบ journey builder (ภาพอ้างอิงแบบ CleverTap: palette Entry / Channels / Flow /
> Integrations ลากวางลง canvas แนวนอน) และให้ **commerce เป็นคนรัน workflow** จบในตัวเท่าที่ทำได้ ส่วน push / email /
> in-app / คูปอง ให้ commerce ส่งไปให้ josh ทำ
> ทางเลือกที่ user เลือก: เพิ่ม Webhook + A/B split · ตั้ง URL / header / body เองต่อ step · header ที่เป็นความลับเก็บ
> เข้ารหัสใน commerce · commerce รัน engine เอง (B) · แบ่งเฟสตามด้านล่าง
> เกี่ยวข้อง: `2026-10-06-josh-to-commerce-ownership-move-design.md`

## 1. เป้าหมาย ขอบเขต และเฟส

**เฟส 1 (เอกสารนี้):** commerce มี marketing workflow ของตัวเอง — เก็บ, รัน (enroll / wait / condition / split /
webhook), วัดผล และมี editor ใหม่แบบ palette ลากวาง

| เฟส | เนื้อหา |
|---|---|
| **1** | engine ของ commerce · trigger: scheduled, order milestone, first login, app login · step: audience, wait, condition, A/B split, webhook, notify (push / email / in-app ผ่าน josh), แจกคูปอง (ผ่าน josh) · editor ใหม่ |
| 2 | josh ส่ง event ตะกร้า / page view / device มา commerce → trigger cart idle, page affinity, first visit, custom · condition `cart.*`, `page.views` · Popup Offer |
| 3 | ย้าย workflow เดิมจาก josh มารันใน commerce แล้วปิด cron ของ josh สำหรับ workflow เหล่านั้น · frequency cap รวมระบบเดียว |

**ไม่อยู่ในเฟส 1:** Popup Offer, trigger ที่ต้องใช้ตะกร้า / page view / device, แยกกิ่งตาม response ของ webhook,
หมวด Integrations สำเร็จรูป (Slack / Sheets / LLM — ใช้ Webhook แทน), SMS / LINE, MCP tools สำหรับ workflow ของ commerce,
การรายงานผลส่งจริงจาก josh กลับมา commerce (opt-out / ส่งไม่สำเร็จ)

**ไม่เปลี่ยน:** workflow ของ josh ทุกตัวรันใน josh ตามเดิม · editor เดิม (`workflow-editor/josh/*`) ยังใช้แก้ workflow ของ josh ·
notify template และ popup ยังอยู่ใน josh (commerce อ่านผ่าน admin-call เหมือนตอนนี้)

## 2. ข้อมูลที่ commerce ใช้ (มีอยู่แล้ว)

- `josh_customers.data` (จาก `customer.snapshot`): `first_app_login_at`, `last_app_login_at`, `marketing_consent`,
  `preferred_language` ฯลฯ — login มาถึงเป็น snapshot ใหม่ภายในไม่กี่วินาที (drainer josh ทุก ~3 วิ)
- `josh_orders` + ลูก (จาก `order.snapshot`) และ `customer_metrics` (คำนวณจาก `josh_orders`)
- segments ของ commerce (`modules/integration/segments`) — เพิ่ม `userMatchesSegment(segmentId, userId)` โดยใช้ SQL ที่
  compile แล้วเดิม + `AND u.id = $x` · rule แบบ live (guest, first_visit, staff, role…) ที่ commerce ไม่ประเมินอยู่แล้ว
  → ใช้เป็น audience ไม่ได้ (editor ไม่ให้เลือก)
- tester list ของ commerce (กฎ test send เดิม)
- BullMQ + `@nestjs/schedule` ที่ตั้งไว้แล้วใน `app.module.ts`

## 3. ข้อมูลของ workflow (commerce)

โมดูลใหม่ `apps/commerce-platform/src/modules/integration/marketing-workflow/` · ชื่อ field ตรงกับ josh ทุกตัวที่มีเหมือนกัน
เพื่อให้เฟส 3 ย้ายข้อมูลได้ตรงๆ

### 3.1 ตาราง (migration ใหม่)

- **`marketing_workflows`**: `id uuid`, `name`, `status` (`draft|active|paused`), `trigger_type`, `trigger_config jsonb`,
  `steps jsonb`, `graph_ui jsonb`, `cooldown_days int`, `holdout_percent int`, `conversion_window_days int`,
  `exit_on_goal jsonb` (`{kind:'order_placed'} | null`), `schedule jsonb`, `activated_at timestamptz null`,
  `created_by`, `updated_by`, timestamps
- **`marketing_workflow_revisions`**: `workflow_id`, snapshot jsonb, `created_by`, `created_at` (บันทึกทุกครั้งที่ save)
- **`marketing_workflow_enrollments`**: `id`, `workflow_id`, `user_id` (josh user id), `occurrence_key varchar(64)`,
  `status` (`pending|running|completed|skipped|failed`), `current_step_id null`, `resume_at null`, `is_holdout bool`,
  `split_assignments jsonb default '{}'` (`{stepId: branchId}`), `started_at`, `completed_at null`, `end_reason null`,
  `converted_at null` · unique (`workflow_id`, `user_id`, `occurrence_key`) · index (`status`, `resume_at`)
- **`marketing_workflow_action_logs`**: `id`, `enrollment_id`, `step_id`, `kind`
  (`notify|grant_coupon|webhook|split|condition|gate`), `status` (`sent|queued|skipped|failed`), `meta jsonb`, `created_at`
  · index (`enrollment_id`), (`kind`, `created_at`)
- **`marketing_webhook_secrets`**: `id uuid`, `name varchar(128)`, `value_encrypted text`, `created_by`, timestamps
- frequency cap ไม่สร้างตารางใหม่ — เก็บในตาราง `settings` ที่มีอยู่ (`modules/core/settings`):
  `scope='marketing_workflow'`, `key='frequency_cap'`, `value={ enabled: false, maxPerUserPerDay: 3 }`

### 3.2 Step types (เฟส 1)

```ts
type Step =
  | { id; type: 'audience'; segmentIds?: string[]; excludeSegmentIds?: string[]; nextId: string | null }
  | { id; type: 'wait'; hours: number; minutes?: number; nextId: string | null }
  | { id; type: 'condition'; expression: string; yesNextId: string | null; noNextId: string | null }
  | { id; type: 'split'; branches: { id; label; percent; nextId: string | null }[] }   // 2–4 กิ่ง รวม 100
  | { id; type: 'action'; action:
        | { kind: 'notify'; channels: ('push'|'email'|'in_app')[]; templateKey: string; data?: object }
        | { kind: 'grant_coupon'; couponId: string };
      nextId: string | null }
  | { id; type: 'webhook'; method: 'POST'|'PUT'|'PATCH'|'GET'; url: string;
      headers: { key; value }[];   // value อาจเป็น {{secret:<uuid>}} ทั้งค่า
      body?: string; nextId: string | null }
```

ต่างจาก josh: **`nextId` บังคับมีเสมอ** (ไม่มี "ตัวถัดไปใน array" แบบนัย ลำดับใน array ไม่มีความหมาย) และ step แรกคือ
**`entry_step_id`** ในตาราง workflow (step ที่ trigger ชี้; null = ยังไม่ต่อ) — เพิ่ม column นี้ใน `marketing_workflows`
ตอนย้ายเฟส 3 แปลง next แบบนัยของ josh เป็น `nextId` ชัดเจน

### 3.3 Trigger types (เฟส 1)

| trigger_type | config | enroll เมื่อ | occurrence_key |
|---|---|---|---|
| `scheduled` | `{ time, daysOfWeek?, timezone? }` เหมือน josh | cron ทุกนาที: ถึงเวลา → enroll ทุกคนใน audience (ไม่มี audience = ลูกค้าทุกคนใน `josh_customers` ที่ไม่ถูกลบ) | วันที่รอบนั้น (`YYYY-MM-DD`) |
| `order_milestone` | `{ metric, operator, value }` เหมือน josh | หลังรับ `order.snapshot` ของ user: คำนวณ metric จาก `josh_orders` ด้วยนิยาม "ชำระแล้ว" เดียวกับ `customer_metrics` เข้าเงื่อนไขครั้งแรกหลัง `activated_at` | `once` |
| `first_login` | `{}` | หลังรับ `customer.snapshot`: `first_app_login_at` ≥ `activated_at` | `once` |
| `app_login` | `{}` | หลังรับ `customer.snapshot`: `last_app_login_at` ≥ `activated_at` และเปลี่ยนจากค่าที่ enroll ล่าสุด | ค่า `last_app_login_at` (ISO) |

- `activated_at` ตั้งเมื่อกด activate ครั้งแรก (และทุกครั้งที่ activate ใหม่หลัง pause) — กัน activate แล้วยิงลูกค้าเก่าทั้งหมด
- `cooldown_days` ใช้กับทุก trigger: มี enrollment ของ workflow+user ภายใน N วันแล้ว → ไม่ enroll
- `schedule` (ช่วงเวลาทำงาน) ใช้เหมือน josh: นอกช่วง → ไม่ enroll
- การเช็ก trigger จาก event **ไม่ทำใน transaction ของ josh-events** — หลัง `apply()` สำเร็จ enqueue job
  `marketing-trigger` (`{ kind: 'customer'|'order', userId }`) แบบไม่รอ ให้รับ event ช้าลงไม่ได้
- `customer.deleted` → ปิด enrollment ที่ยังไม่จบของ user เป็น `skipped: customer_deleted` · action log meta ไม่เก็บ PII
  ตั้งแต่แรก (4.4) จึงไม่ต้องลบเพิ่ม

### 3.4 Condition (เฟส 1)

copy parser + evaluator ของ josh (`marketing-expression.parser.ts`, `.evaluator.ts` เป็น pure) มาไว้ในโมดูล
field ที่รองรับ: `still_no_order`, `user.order_count`, `segment.in`, `time.in_schedule`, `time.hour`, `time.dow`
field อื่น (`cart.*`, `page.views`) → validator ปฏิเสธพร้อมข้อความ "ใช้ได้ในเฟส 2"

## 4. Engine

### 4.1 การรัน

- `enroll(workflow, userId, occurrenceKey)`: insert enrollment (unique กันซ้ำ; ชน = ข้าม) · สุ่ม holdout จาก hash
  (`holdout_percent`) — holdout → `completed: holdout` ไม่ส่งอะไร · ผ่าน audience ตอน enroll · แล้ว `run(enrollment)`
- `run(enrollment, fromStepId)`: เดินตาม `nextId` · นับ visit กัน cycle (เกินจำนวน step + 1 → `failed: cycle_detected`)
  - `audience` ผ่าน
  - `wait` → `status=running`, `resume_at`, `current_step_id=next` แล้วจบรอบ (delayed job BullMQ คิว `marketing-workflow`
    เป็นทางหลัก + sweep ทุก 1 นาที หา `resume_at <= now()` เป็นทางสำรอง — แบบเดียวกับ josh) · enqueue ไม่ await
  - `condition` → ประเมิน แล้วไป yes / no
  - `split` → ดู 4.2
  - `action` / `webhook` → ก่อนทำ: เช็ก exit goal, เช็ก audience อีกรอบ (กันคนที่ออกจาก segment ระหว่าง wait), workflow ยัง
    `active` → ทำ → ไปต่อ
  - ถึง `nextId = null` → `completed`
- การ resume ใช้ `SELECT … FOR UPDATE SKIP LOCKED` (กัน delayed job กับ sweep ทำซ้ำ)
- workflow ถูก pause → enrollment ที่รออยู่จะ resume แล้วจบเป็น `skipped: workflow_paused`

### 4.2 A/B split

`bucket = uint32(sha256(enrollment.id + ':' + step.id)[0..4]) % 100` ไล่บวก percent ตามลำดับกิ่ง · บันทึกลง
`split_assignments` และ action log `split` (`meta: { branchId, label }`) · ได้กิ่งเดิมเสมอ

### 4.3 Notify และแจกคูปอง (ส่งผ่าน josh)

ใช้รูปแบบเดียวกับ `winback.notify` (commerce publish domain event → outbox → josh `internal/erp-events` → josh ทำ)
ข้อดี: josh ล่ม → event รอใน outbox แล้วส่งทีหลัง ไม่หาย

- event `marketing.notify`: `{ userId, templateKey, channels, data, dedupeKey: 'cmw:<workflowId>:<enrollmentId>:<stepId>' }`
- event `marketing.grant_coupon`: `{ userId, couponId, idempotencyKey: 'cmw:<enrollmentId>:<stepId>' }`
- commerce log `queued` ทันทีที่ publish (ไม่รู้ผลจริงจาก josh ในเฟส 1)
- frequency cap ของ commerce (ถ้าเปิด): นับ action log `notify` สถานะ `queued` ของ user วันนี้ (เวลาไทย) ทุก workflow
  ของ commerce → เกิน → `skipped: frequency_cap`

### 4.4 Webhook (commerce ยิงเอง)

1. แทนค่าตัวแปรใน `url`, `headers[].value`, `body` ด้วยรูปแบบเดียวกับ notify template ของ josh (`{{user_name}}`,
   `{{user_first_name}}`, `{{user_last_name}}`, `{{user_email}}`, `{{user_phone}}`, `{{user_custype}}`, `{{cuisine_name}}`,
   `{{today}}` จาก `josh_customers.data`) และ `{{user_id}}`, `{{workflow_id}}`, `{{workflow_name}}`, `{{enrollment_id}}`,
   `{{step_id}}` — ค่า `{{secret:…}}` ไม่แตะ · escape ตามที่ใส่: ใน URL ใช้ `encodeURIComponent`, ใน body ที่เป็น JSON
   escape เป็น JSON string, ใน header ตัด CR/LF
2. SSRF guard (4.5) กับ URL ที่แทนค่าแล้ว ไม่ผ่าน → log `failed: blocked_url` ไปต่อ
3. สร้างแถว `webhook_deliveries` (`kind='marketing'`, `idempotency_key='cmw:<enrollmentId>:<stepId>'`) แล้ว enqueue
   `QUEUES.WEBHOOK_OUT` → log `queued` (`meta: { method, host, deliveryId }` — ไม่เก็บ header / body / query) → ไปต่อทันที
   ไม่รอผล

`webhook_deliveries` (migration): `subscription_id` → nullable · เพิ่ม `kind varchar(16) default 'event'`,
`method varchar(8) null`, `headers jsonb null` (ยังไม่แทนค่า secret), `idempotency_key varchar(191) null` + unique partial index
marketing delivery: `event_type='marketing.webhook'`, `payload` = body string, `event_id` null

`WebhookDeliveryWorker.handle()` เมื่อ `kind='marketing'`: ข้าม supersede check และ portal allowlist · เช็ก SSRF ซ้ำตอนส่ง
(กัน DNS rebinding) · แทนค่า secret **ตอนส่งเท่านั้น** ค่าจริงไม่ลง DB / log / error · ใช้ method + headers ที่กำหนด +
`x-delivery-id` · GET ไม่มี body · ไม่ได้ตั้ง `Content-Type` → `application/json` · `redirect: 'manual'` (3xx = failed
`redirect_not_followed`) · timeout 10 วิ, 4xx เหมือนเดิม · retry สูงสุด 20 ครั้ง (`deliveryBackoff` เดิม ~15 นาที — ไม่ใช่
200 ครั้งแบบ delivery ถึง josh) · ถ้าไม่สำเร็จ ไปขึ้นใน `webhook_failures` เหมือนเดิม

### 4.5 SSRF guard

`assertPublicHttpUrl(url)`: scheme `http`/`https` · resolve DNS ทุก address · ปฏิเสธถ้ามีตัวใดอยู่ใน 0.0.0.0/8, 127/8,
10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, ::, ::1, fe80::/10, fc00::/7 หรือ IPv4-mapped ของช่วงเหล่านี้
ใช้ตอนบันทึก step (เช็กเฉพาะ URL ที่ไม่มีตัวแปร), ตอนรัน และตอนส่ง

### 4.6 Secret

- AES-256-GCM: ย้าย `modules/platform/scraping/infrastructure/credential-cipher.ts` เป็น helper กลางที่รับชื่อ env ของ key ·
  scraping ใช้ `SCRAPING_CREDENTIALS_KEY` เหมือนเดิม · marketing ใช้ `MARKETING_WEBHOOK_SECRETS_KEY` (เพิ่มใน `.env.example`)
  ไม่ได้ตั้ง → สร้าง secret ไม่ได้ ขึ้นข้อความให้แจ้งทีมระบบ
- Admin API: สร้าง (คืน id), แทนค่า, ลบ, list (ชื่อ + id) — **ไม่มี endpoint ที่คืนค่าจริง**
- secret ที่ถูกลบ → delivery ที่อ้างถึง failed `secret_missing` ตอนส่ง
- action log meta และ revision ไม่มีค่า secret (เก็บแค่ `{{secret:id}}`)

### 4.7 วัดผล

- conversion: หลังรับ `order.snapshot` (ชำระแล้ว) ของ user → enrollment ของ user ที่ `started_at` อยู่ใน
  `conversion_window_days` และยังไม่มี `converted_at` → ตั้ง `converted_at`
- exit goal `order_placed`: เช็กก่อน action / webhook ทุกตัว — มี order ชำระแล้วหลัง `started_at` → `skipped: goal_reached`
- Analytics API ต่อ workflow: enrolled / running / completed / skipped / failed / converted / holdout, จำนวน action ตาม kind +
  สถานะ, **ผลต่อกิ่งของแต่ละ split** (`entered`, `converted`, `%`) และ conversion ของ holdout เทียบกลุ่มที่ได้รับข้อความ

### 4.8 Admin API (commerce-platform)

CRUD workflow (+ revision), activate / pause, validate, preview จำนวนคนที่จะเข้า (scheduled / audience), analytics,
enrollments (หน้าละ 50), action logs ของ enrollment, secrets, ส่ง webhook ทดสอบ, **รันทดสอบกับ tester**
สิทธิ์: สิทธิ์เดียวกับการแก้ marketing workflow ใน commerce-admin ตอนนี้

- validator ตอนบันทึก / activate: ทุก `nextId` ชี้ step ที่มีจริงหรือ null · ไม่มี cycle · `entry_step_id` ต้องมีก่อน activate ·
  split 2–4 กิ่ง percent จำนวนเต็ม 1–99 รวม 100 · webhook (method, url `http(s)://` ≤ 1024, header ≤ 20 แถว key ตาม RFC 7230,
  body ≤ 16 KB) · notify ต้องมี templateKey และ channel ≥ 1 · condition field เฉพาะ 3.4 · wait รวม ≥ 1 นาที ·
  จำนวน wait / condition ไม่เกินค่าคงที่เดียวกับ josh (`MAX_MARKETING_WAIT_STEPS`, `MAX_MARKETING_CONDITION_STEPS`)
- ส่ง webhook ทดสอบ: ใช้ตัวแปรตัวอย่าง → SSRF guard + แทนค่า secret → ยิงจริงหนึ่งครั้ง (ไม่ retry, ไม่เข้า queue) → คืน
  status code + body ตอบกลับ 2 KB แรก
- รันทดสอบ: เลือก tester หนึ่งคน (เฉพาะคนใน tester list) → enroll แบบ `occurrence_key='test:<timestamp>'` ข้าม trigger /
  cooldown / schedule, wait ถูกย่อเหลือ 0 ถ้าเลือก "ข้าม wait" · ส่งจริง (notify / คูปอง ผ่าน josh, webhook ยิงจริง)

## 5. ฝั่ง josh (เพิ่มอย่างเดียว)

ใน `internal/erp-events` (ตัวรับเดียวกับ `winback.notify`) เพิ่ม 2 type — josh ตอบ 422 กับ type ที่ไม่รู้จัก และ commerce
ถือ 4xx เป็น dead-letter (ไม่ retry) จึง**ต้อง deploy josh ก่อน** แล้วค่อยเพิ่ม 2 type นี้เข้า subscription ของ josh
(`ops/scripts/josh-subscription.cjs`, `SCRIPT_ARGS='add=marketing.notify,marketing.grant_coupon'`) — subscription คือสวิตช์
เปิดการส่ง ไม่ต้องมี env flag ใหม่ฝั่ง josh (แบบเดียวกับ `winback.notify`)

- `marketing.notify` → ทำแบบเดียวกับ notify ใน runner ของ josh: `notifyTemplates.findByKey` →
  `buildTemplateVarsForUser` → `buildNotifyTemplateOverride` → `notificationService.dispatch({ userId, type: templateKey,
  category: 'marketing', data, dedupeKey, channels, locale, override })` — marketing opt-out อยู่ใน dispatch แล้ว ·
  dedupe ด้วย `dedupeKey` ที่ dispatch มีอยู่แล้ว · ใช้ global frequency cap ของ josh ด้วย (นับ log ของ josh เอง)
- `marketing.grant_coupon` → `couponEntitlementService.grantFromMarketingWorkflow(couponId, userId)` (idempotent ต่อ
  coupon + user อยู่แล้ว)
- DTO ตรวจแบบเดียวกับ `WinbackNotifyDto` (`userId` UUID, `templateKey` pattern, `channels` ใน 3 ค่า, `dedupeKey` ≤ 200)
- ไม่แตะ cron / runner / workflow ของ josh · ไม่ทำให้ josh ช้าลง (งานต่อ event เท่ากับ notify หนึ่งครั้งที่ runner ทำอยู่)

## 6. ฝั่ง commerce-admin (editor ใหม่)

หน้าใหม่สำหรับ workflow ของ commerce (route ใหม่ใต้ การตลาด › ข้อความอัตโนมัติ) · หน้า list เดิม (`MarketingWorkflows.tsx`)
แสดง 2 กลุ่ม: "Workflow ของ commerce (ใหม่)" กับ "Workflow ของ josh" (ตัวเดิม เปิด editor เดิม) · ปุ่มสร้างใหม่สร้างใน commerce

ไฟล์ใหม่อยู่ใน `apps/commerce-admin/src/app/pages/marketing-workflow/` · reuse ได้จาก `workflow-editor/josh/`:
`TriggerRuleBuilder` (ส่วน schedule / order milestone), schedule editor, ตัวเลือก segment / coupon / notify template,
`api-client` ของ admin-call สำหรับอ่าน template / coupon ของ josh

### 6.1 Layout

palette ซ้าย (~240px, ยุบได้) · canvas แนวนอน `@xyflow/react` (พื้น grid) · แผงตั้งค่าขวา (~320px)

### 6.2 Palette

ช่องค้นหาด้านบน · หมวดยุบได้ · ไอคอนสี่เหลี่ยมมนสีตามหมวด

| หมวด (สี) | รายการ | step |
|---|---|---|
| ENTRY (เขียว) | Scheduled, Order milestone, First login, App login | เปลี่ยน trigger (มีตัวเดียว) แล้วเลือกการ์ด trigger |
| CHANNELS (ม่วง) | Push, Email, In-App, Webhook | `action notify` channel ตามชื่อ / `webhook` |
| FLOW (ฟ้า) | Time Delay, Condition Split, A/B Split, Audience filter | `wait` / `condition` / `split` / `audience` |
| REWARDS (ส้ม) | แจกคูปอง | `action grant_coupon` |

รายการที่ใช้ไม่ได้ตอนนี้ (Audience ≤ 1, Wait / Condition ถึงจำนวนสูงสุด) เป็นสีเทาพร้อม tooltip เหตุผล
ไม่แสดงรายการของเฟส 2

### 6.3 การเพิ่ม step — ทุกทางเรียก `insertStep(kind, anchor)` ตัวเดียว

1. **ลากวาง** (HTML5 drag + `screenToFlowPosition`): วางบนการ์ด → แทรกต่อจากการ์ดนั้น (ถ้าการ์ดมี next อยู่แล้ว step ใหม่
   ชี้ต่อไปที่ next เดิม) · การ์ดที่มีหลายทางออก (condition / split) → ต่อทางออกแรกที่ว่าง ถ้าเต็มแสดง popover ให้เลือกทางออก ·
   วางที่ว่าง → สร้างตรงตำแหน่งนั้นแบบยังไม่ต่อเส้น
2. **ปุ่ม `+`** ที่จุดออกของการ์ด → popover palette ย่อ → แทรกต่อจากจุดออกนั้น
3. **คลิก / Enter** รายการใน palette → แทรกต่อจากการ์ดที่เลือกอยู่ (ไม่ได้เลือก → ต่อท้ายเส้นหลัก) — ใช้ได้ด้วย keyboard

logic กราฟ (insert, ต่อ / ตัดเส้น, ลบ step แล้วต่อเส้นข้าม, จัดเรียงอัตโนมัติ) อยู่ในไฟล์ pure `workflow-graph.ts` พร้อม test

### 6.4 การ์ดและ canvas

- การ์ด ~240×72: ไอคอนสีหน้าชื่อ, ชื่อ, สรุปหนึ่งบรรทัด · จุดเข้าซ้าย จุดออกขวา · ปุ่มลบ
- Condition: จุดออก Yes / No (ขวาบน / ขวาล่าง) มีป้าย · A/B split: จุดออกตามจำนวนกิ่ง ป้าย `A 50%`
- เส้นแนวนอน `smoothstep` มีหัวลูกศร
- canvas ที่มีแต่ trigger: hint "Entry → Message/Action → +" แบบภาพอ้างอิง
- step ที่ไม่มีตำแหน่งวางแนวนอนอัตโนมัติ · ปุ่ม **"จัดเรียงอัตโนมัติ"**: layer ตามความลึก (BFS จาก trigger) กิ่งแยกแกน y ·
  ไม่เพิ่ม lib layout

### 6.5 แผงขวา

- **Trigger:** ฟอร์มตาม trigger_type · ช่วงเวลาทำงาน (schedule) · cooldown, holdout, conversion window, exit goal
- **Audience:** segment include / exclude (เฉพาะ segment ที่ commerce ประเมินได้) · แสดงจำนวนคนโดยประมาณ
- **Wait:** ชั่วโมง + นาที
- **Condition:** ตัวสร้าง expression (field ตาม 3.4) + ช่องพิมพ์เอง + validate
- **Notify (Push / Email / In-App):** เลือก notify template ของ josh (อ่านผ่าน admin-call) · channel ติ๊กเพิ่มได้ · ลิงก์ไปหน้า
  template เดิม
- **แจกคูปอง:** เลือกคูปองของ josh
- **Webhook:** method, URL, ตาราง header (key / value / ติ๊ก "ความลับ" → กรอกค่าใหม่ บันทึกผ่าน secret API → แสดง
  `•••• (ชื่อ)` เปลี่ยนได้ ดูค่าเดิมไม่ได้) · body template + รายการตัวแปรคลิกแทรก · "ส่งทดสอบ" (แสดง status + body ตอบกลับ) ·
  เตือน URL ที่ไม่ผ่าน SSRF guard ตั้งแต่ตอนกรอก (เฉพาะ URL ไม่มีตัวแปร)
- **A/B split:** รายการกิ่ง (ชื่อ, %) เพิ่ม / ลบ 2–4 กิ่ง, ปุ่ม "แบ่งเท่ากัน", เตือนเมื่อรวมไม่ 100

### 6.6 หน้าอื่น

- แถบบน editor: ชื่อ, สถานะ, บันทึก, Activate / Pause (แสดงข้อผิดพลาดจาก validator ชี้ไปที่การ์ด), รันทดสอบ (เลือก tester),
  ประวัติ revision
- แท็บ **ผลลัพธ์**: ตัวเลขจาก 4.7 + ตารางผลต่อกิ่งของ split + holdout เทียบกลุ่มที่ได้รับ
- แท็บ **Enrollments**: รายการ + action log ต่อคน

## 7. Rollout

1. **josh backend**: 2 event type ใน `internal/erp-events` (5) — deploy ก่อน เพราะยังไม่มีใครส่งมา
2. **commerce-platform**: โมดูล `marketing-workflow` + migration + webhook delivery + SSRF + secrets · ตั้ง
   `MARKETING_WEBHOOK_SECRETS_KEY` ใน prod · ยังไม่มี workflow ไหน active = ไม่มีผลกับระบบ
3. **เปิดการส่งไป josh**: เพิ่ม `marketing.notify`, `marketing.grant_coupon` เข้า subscription ของ josh (หลังข้อ 1 เท่านั้น)
4. **commerce-admin**: editor ใหม่ + list 2 กลุ่ม · master มี commit ของ `release/admin-task-navigation-20261009` ครบแล้ว
   (ตรวจ 2026-10-10) จึงทำต่อจาก master ได้ — ตรวจซ้ำก่อน deploy ว่า branch ที่ prod รันไม่มี commit ที่ master ไม่มี
5. ทดสอบจริงบน prod ด้วย "รันทดสอบ" กับ tester เท่านั้น ก่อน activate workflow แรก

**ความเสี่ยงที่ยอมรับในเฟส 1:** frequency cap แยกกันสองระบบ — ลูกค้าอาจได้ข้อความจาก workflow ของ josh + commerce รวมกันเกิน cap
(josh ใช้ cap ของตัวเองกับ `marketing.notify` ด้วย จึงกันได้บางส่วน) · แก้จริงในเฟส 3

## 8. Error handling

| สถานการณ์ | ผล |
|---|---|
| josh ล่ม | event `marketing.*` รอใน outbox แล้วส่งเมื่อ josh กลับมา · workflow เดินต่อตามปกติ |
| josh ยังไม่ deploy ตัวรับ | ไม่เกิด เพราะ type ยังไม่อยู่ใน subscription ของ josh (rollout ข้อ 3) — ถ้าเพิ่มผิดลำดับ josh ตอบ 422 → dead-letter, ส่งซ้ำด้วยมือจาก dead-letter ได้ |
| Redis ล่ม | delayed job หาย → sweep ทุก 1 นาทีเป็นทางสำรอง · enqueue ไม่ await |
| resume ซ้ำ (job + sweep) | `FOR UPDATE SKIP LOCKED` + เช็ก `current_step_id` |
| URL ชี้ IP ภายใน / resolve ไม่ได้ | `failed: blocked_url` ไม่ยิง ไปต่อ |
| ปลายทาง 5xx / 408 / 429 / timeout | retry ตาม `deliveryBackoff` → `webhook_failures` |
| ปลายทาง 4xx อื่น / 3xx | failed ทันที ไม่ retry |
| secret ถูกลบ / key ไม่ได้ตั้ง | `secret_missing` / `secret_key_missing` ไม่ส่ง |
| ลูกค้าถูกลบ (PDPA) | ปิด enrollment `skipped: customer_deleted` · webhook ที่ยังไม่ส่งของ user ถูก mark failed |
| workflow ถูกแก้ระหว่างที่มีคนรออยู่ | resume ใช้ steps ปัจจุบัน · `current_step_id` ไม่มีแล้ว → `skipped: step_removed` |
| validator ไม่ผ่าน | บันทึก draft ได้ แต่ activate ไม่ได้ · UI ชี้การ์ดที่ผิด |

## 9. การทดสอบ

- **commerce engine (unit, jest):** enroll (unique / cooldown / schedule / activated_at / holdout) · run ตาม nextId ทุก step type ·
  cycle · wait → resume (job + sweep ไม่ซ้ำ) · split ได้กิ่งเดิมเสมอและ 10,000 enrollment แบ่งใกล้ % (±2) · condition
  field เฟส 1 · exit goal · conversion · frequency cap · pause ระหว่างรอ · step ถูกลบ · customer.deleted
- **trigger:** scheduled (เวลา + วัน + timezone) · order_milestone 3 metric · first_login / app_login เทียบ activated_at และไม่ซ้ำ
  · job เช็ก trigger ไม่อยู่ใน transaction ของ josh-events
- **webhook:** SSRF guard (ทุกช่วงใน 4.5 + โดเมนที่ resolve ไป IP ภายใน) · แทนค่าตัวแปร · secret แทนค่าตอนส่งเท่านั้นและไม่หลุด
  ลง DB / log · idempotency · worker kind marketing (method, headers, GET ไม่มี body, ไม่ตาม redirect) · secret API ไม่คืนค่าจริง ·
  cipher helper ใช้กับ scraping ได้เหมือนเดิม
- **josh:** receiver 2 type (DTO ถูก / ผิด, dispatch ถูกเรียกด้วย dedupeKey, grant idempotent)
- **commerce-admin:** `workflow-graph.ts` (insert ระหว่าง step / ทางออก condition / split, ลบแล้วต่อเส้นข้าม, จัดเรียง) ·
  เปิดหน้าจริงใน browser: ลากวาง, `+`, คลิก palette, ต่อ / ตัดเส้น, บันทึก, เปิดใหม่ได้เหมือนเดิม
- **end-to-end (staging แล้ว prod):** workflow scheduled → split → Email (template ทดสอบ) / Webhook (request bin) →
  "รันทดสอบ" กับ tester ที่อีเมลคือ **pongpanot_s@jagota.co.th** · ตรวจว่าเมลมาถึง, webhook มาถึงพร้อม header ที่แทนค่า secret
  แล้ว, ผลขึ้นในแท็บผลลัพธ์

## 10. Implementation notes (2026-10-10, ต่างจาก spec ข้างบน)

- `marketing.grant_coupon` ส่งแค่ `{ userId, couponId }` — josh grant idempotent ต่อ coupon + user อยู่แล้ว และ controller กันซ้ำด้วย `x-delivery-id` จึงไม่มี idempotencyKey
- ตอนรัน engine ตรวจแค่ scheme ของ URL — การตรวจ SSRF แบบ resolve DNS ทำตอนบันทึก/activate (URL ที่ไม่มีตัวแปร) และตอนส่ง (worker) เพื่อไม่ถือ row lock ระหว่างรอ DNS
- Enrollments แสดงในแท็บ "ผลลัพธ์" ไม่แยกแท็บ
- เพิ่มคอลัมน์ `is_test`, `skip_waits` (enrollment) และ `last_scheduled_key` (workflow) สำหรับรันทดสอบและ scheduled ที่ทำต่อหลัง crash
- marketing webhook ใช้คิว/worker ของตัวเอง (`marketing-webhook`) แทน worker ของ subscription เดิม — worker เดิมข้ามแถว `kind = 'marketing'`; แถวยังอยู่ใน `webhook_deliveries` จึงขึ้นใน MCP `webhook_failures` ได้ (delivery monitor ไม่เห็นเพราะ join subscription)
- josh: `CommerceErpEventsController` รับ service ใหม่แบบ `@Optional()` + `ownedMarketing()` (ไม่ได้ wire → 5xx ให้ commerce retry) เพราะ parameter ตัวท้ายเป็น optional ทั้งหมด
- วางการ์ดบนการ์ดที่ทุกทางออกมีปลายทางแล้ว → แทรกที่ทางออกแรก (ปลายทางเดิมต่อท้าย step ใหม่) แทน popover ให้เลือกทางออก
- trigger จาก snapshot (first_login / app_login / order_milestone) นับเฉพาะเหตุการณ์ใน 60 นาทีล่าสุด (`TRIGGER_RECENT_MINUTES`) — ถ้าตอนนั้น enroll ไม่ได้ (นอกช่วงเวลา, cooldown, ไม่อยู่ใน audience) จะไม่ไป enroll ภายหลังตอน snapshot อื่นที่ไม่เกี่ยว (จาก final review)
- PDPA (`customer.deleted`) ทำในทรานแซกชันเดียวกับ josh-events: หยุด enrollment แล้ว fail แถว webhook ที่ยังไม่ส่ง และล้าง URL / headers / body ของแถว webhook ทุกแถวของลูกค้า
- ส่ง webhook ทดสอบ: ค่า secret ที่ปลายทางสะท้อนกลับมาใน body ถูกปิดเป็น `••••` ก่อนตัด 2 KB
