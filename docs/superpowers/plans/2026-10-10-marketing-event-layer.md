# Marketing event layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce owns customer behaviour events (one ingest API for shop-web and mobile), links devices to users, and uses events in marketing workflows: event trigger, Wait for event, event goal, event rules (workflow nodes + dynamic segments), guest journeys.

**Architecture:** A new NestJS module `modules/integration/marketing-events` owns the event catalog, the public ingest endpoint, the partitioned `marketing_events` table, device links / consent, dynamic segments, the nightly retention job and the event-rule SQL compiler. Pure rules (catalog validation, attribute filters, attribution, rule validation + SQL compile) live in `marketing-events/domain`. The existing `marketing-workflow` module consumes it: new trigger `event`, steps `wait_event` / `event_split`, event goals, guest enrollments. josh-events gains `device.snapshot` (link + consent) and runs consent withdrawal / PDPA cleanup in its own transactions. josh adds the `user_devices` outbox trigger and device-targeted push; shop-web sends events.

**Tech Stack:** NestJS 11, TypeORM (raw SQL), Postgres declarative partitioning, BullMQ, @nestjs/schedule (`@Cron`, `@Interval`), @nestjs/event-emitter, zod v4, express-rate-limit (`Throttle`), jest (ts-jest) · React + Vite + Tailwind v4, vitest · josh: NestJS, class-validator, jest · shop-web: Next.js.

**Spec:** `docs/superpowers/specs/2026-10-10-marketing-event-layer-design.md` (read it with this plan; § numbers below refer to it)

## Global Constraints

- commerce migrations: `apps/commerce-platform/src/migrations/<ts>-Name.ts`, this plan's timestamp **1796400000000**; entity files end in `.entity.ts` (glob-registered); `synchronize` is off; uuid PKs `DEFAULT uuid_generate_v4()`.
- No new npm dependencies (commerce, admin, josh, shop-web).
- Admin controllers: `@StaffRoles('marketing')`, bodies parsed with zod via `parse()` from `modules/integration/growth/growth.validation.ts`, raw objects returned.
- Public ingest: `POST /api/events`, `@Public()`, off unless `MARKETING_EVENTS_INGEST_ENABLED=true` (→ `503 { code: 'ingest_disabled' }`).
- Ingest limits (verbatim from spec §3): `events` 1–20 · body ≤ 32 KB · attributes ≤ 20 keys and JSON ≤ 2 KB · `occurredAt` ≤ 5 min in the future, ≤ 7 days old · 120 requests/min per IP + 60 events/min per `deviceId`.
- `deviceId` = `^[A-Za-z0-9_-]{8,64}$` (josh `individual_id`; web ids are 32 hex chars). Every other id is a UUID.
- Event facts are never updated after insert; only `attributed_user_id` / `attribution` change (`device_link` | `staff` | `no_consent` | NULL = guest).
- A user is usable only when `josh_customers.data->>'pdpa_consent'` is `true` and the row is not deleted (§5.1). Staff = a `josh_staff` row with `user_type IS DISTINCT FROM 'customer'`.
- Event rules: depth ≤ 4, leaves ≤ 16, window `lastDays` 1–90 or `from`/`to` inside the last 90 days, count 0–1000, and the window may not start before `marketing_event_coverage.collecting_since` (min over platforms).
- Filters ≤ 10 per list; ops per type: string `eq neq contains in(≤50)`, number `eq neq gt gte lt lte`, boolean `eq`, date `before after within_last_days within_next_days (1–365)`; `{ fromTrigger }` only in `wait_event` and event goals, only when the trigger is `event`.
- Limits reused from phase 1: wait + wait_event ≤ 3, condition + event_split ≤ 5, wait timeout 1 … 43 200 min, `TRIGGER_RECENT_MINUTES = 60`.
- Guest push cap `GUEST_PUSH_DAILY_CAP = 1` per device per rolling 24 h, all workflows.
- Retention: partitions are monthly (UTC); drop when the partition's end ≤ now − 90 days; action logs deleted after 180 days; guest push log after 7 days; nightly 03:00 Asia/Bangkok.
- josh changes are additive and default-off: josh→commerce sends only with `JOSH_EVENTS_TO_COMMERCE_ENABLED=true`; the device push path only runs for `marketing.notify` with `target.kind = 'device'`.
- UI copy: every literal through `uiText(...)` with the Thai string as key; every new key gets `{th, en}` in `libs/ui/src/locales/ui-messages.json` (English without Thai).
- Keep commits local; do not push until the user asks.

## Review Focus

1. The same event posted twice (client retry, `sendBeacon` + `fetch`) → stored once, `duplicate` the second time, the trigger enrolls once. Test: Task 5 `event-ingest.service.spec.ts` + Task 11 `workflow-triggers.spec.ts` ("enrolls once per event id").
2. A device used by a guest, then customer A, then customer B; and a `device.snapshot` that arrives late or out of order → events before A and while A → A, after B → B, no fact column changes. Tests: Task 4 `attribution.spec.ts`, Task 6 `device-links.db.spec.ts`.
3. An event arrives at the same moment a Wait-for-event times out → exactly one branch runs, no double send. Test: Task 10 `workflow-engine.spec.ts` ("event after timeout is ignored") + Task 6/10 DB spec for `lockWaiting`.
4. A rule like "add_to_cart = 0 times in the last 30 days" saved two days after go-live → refused with the coverage message instead of matching everybody. Test: Task 4 `event-rule.spec.ts` ("rejects a window before coverage").
5. An attribute value with quotes / SQL text / a JSON object where a number is declared, or a filter key not in the catalog → rejected at ingest or validation, never interpolated into SQL. Tests: Task 2 `event-catalog.spec.ts`, Task 4 `event-rule.spec.ts` ("keys and values are parameters").

## Deviations from the spec (decided while planning — keep them unless the user says otherwise)

- Client sends with `fetch(..., { keepalive: true })` only, no `sendBeacon` (a JSON beacon cross-origin is not CORS-safe; keepalive covers page unload).
- System health shows `marketingEvents { rows, totalBytes, oldestAt, defaultPartitionRows }`; rejected-event counts are in the 5-minute ingest log line, not in health (the counter is per process).
- Consent withdrawn deletes the customer's attributed events and stops journeys but keeps their device links, so their devices are not treated as guests; later events from those devices are stored as `no_consent` and never used. PDPA delete removes the links too.
- `{{event.*}}` in a workflow whose trigger is not `event` is not an activation issue; unknown variables stay visible in rendered text (existing template behaviour).
- An event that arrives for a Wait-for-event while the workflow is paused moves the enrollment, and the next run ends it as `workflow_paused` — the same as a Time Delay resuming while paused.
- The nightly job uses `@Cron` + a Postgres advisory lock instead of a BullMQ repeatable job.

---

## File map

**commerce-platform** (`apps/commerce-platform/src/`)
- Create `migrations/1796400000000-MarketingEventLayer.ts`
- Create `modules/integration/marketing-events/`
  - `domain/event-catalog.ts` (+ spec) — definition rules, PII names, event normalisation
  - `domain/event-filter.ts` (+ spec) — attribute filters: validation + in-memory match
  - `domain/attribution.ts` (+ spec) — which link covers an event
  - `domain/event-rule.ts` (+ spec) — rule validation + SQL compile, JSON reference walker
  - `infrastructure/marketing-event-definition.entity.ts`, `infrastructure/marketing-dynamic-segment.entity.ts`
  - `infrastructure/device-links.ts` (+ `device-links.db.spec.ts`) — links, usable users, link + backfill, consent / PDPA deletes
  - `infrastructure/events.store.ts` — ingest insert, lists, daily, coverage
  - `infrastructure/event-partitions.ts` (+ spec) — partition names / create / drop, health query
  - `application/event-catalog.service.ts`, `application/event-ingest.service.ts` (+ spec), `application/event-rule.service.ts`, `application/dynamic-segments.service.ts`, `application/event-retention.ts`
  - `presentation/events.schemas.ts`, `presentation/events-ingest.controller.ts`, `presentation/marketing-events.controller.ts`, `presentation/dynamic-segments.controller.ts`
  - `marketing-events.module.ts`
- Modify `libs/marketing-workflow/src/index.d.ts` (repo root) — shared types.
- Modify `modules/integration/marketing-workflow/`: `domain/workflow.types.ts`, `domain/workflow.validator.ts` (+ spec), `domain/template.ts` (+ spec), `infrastructure/workflow.store.ts` (+ db spec), `application/workflow-engine.service.ts` (+ spec), `application/workflow-triggers.service.ts` (+ spec), `application/workflow-queue.ts`, `application/workflow.processor.ts`, `application/workflow-trigger.listener.ts`, `application/workflow.service.ts`, `application/workflow-analytics.service.ts`, `application/marketing-events.ts`, `presentation/workflow.schemas.ts`, `presentation/marketing-workflow.controller.ts`, `marketing-workflow.module.ts`.
- Modify `modules/integration/connector/josh/events/josh-events.service.ts` (+ spec), `.../josh-events.controller.ts` (backfill group `device`), `modules/integration/connector/josh/system-health.ts`, `app.module.ts`, `apps/commerce-platform/.env.example`, `docs/event-contract.md`.

**commerce-admin** (`apps/commerce-admin/src/`)
- Modify `lib/api.ts` (`eventsApi`, `dynamicSegmentsApi`), `app/app.tsx` (routes), `app/navigation.ts` (2 entries), `libs/ui/src/locales/ui-messages.json`.
- Create `app/pages/marketing-events/EventsPage.tsx`, `app/pages/marketing-events/DynamicSegmentsPage.tsx`, `app/pages/marketing-events/FilterEditor.tsx`, `app/pages/marketing-events/EventRuleBuilder.tsx`, `app/pages/marketing-events/rule-helpers.ts` (+ spec), `app/pages/marketing-events/index.tsx`.
- Modify `app/pages/marketing-workflow/`: `palette-items.ts` (+ spec), `workflow-graph.ts` (+ spec), `StepPanel.tsx`, `FlowEditorPage.tsx`, `forms/StepForms.tsx`, `forms/TriggerForm.tsx`; create `forms/EventForms.tsx`.

**josh** (`/Users/pongpanot_s/Documents/dev/josh`, new worktree from `origin/main`, branch `feat/commerce-event-layer`)
- Create `apps/backend/src/migrations/1792480000000-CommerceOutboxUserDevices.ts`
- Modify `apps/backend/src/app/commerce-events/commerce-snapshot.builder.ts` (+ spec), `commerce-outbox.drainer.ts`, `commerce-backfill.controller.ts`, `commerce-outbox.trigger.db.spec.ts`
- Modify `apps/backend/src/shared/notification/onesignal.util.ts`, `apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.ts` (+ spec)
- Modify `apps/shop-web/src/lib/analytics.ts`, create `apps/shop-web/src/lib/commerce-events.ts` (+ spec), modify `apps/shop-web/src/lib/onesignal.ts` (read subscription id)

---

## Part A — commerce-platform

### Task 1: Shared types, migration, entities

**Files:**
- Modify: `libs/marketing-workflow/src/index.d.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/domain/workflow.types.ts`
- Create: `apps/commerce-platform/src/migrations/1796400000000-MarketingEventLayer.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/marketing-event-definition.entity.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/marketing-dynamic-segment.entity.ts`

**Interfaces:**
- Produces: every type below (exact names used by all later tasks); tables `marketing_event_definitions`, `marketing_events` (+ partitions), `marketing_event_coverage`, `marketing_devices`, `marketing_device_links`, `marketing_event_daily`, `marketing_dynamic_segments`, `marketing_guest_push_log`, `josh_user_devices`; enrollment columns `device_id`, `waiting_for`, `trigger_event`.

- [ ] **Step 1: Add the shared types** — append to `libs/marketing-workflow/src/index.d.ts` and change the listed existing types:

```ts
// ---- Event layer (spec 2026-10-10-marketing-event-layer) ----
export type EventAttributeType = 'string' | 'number' | 'boolean' | 'date';
export interface EventAttributeDef { key: string; type: EventAttributeType; label: string; archived?: boolean }
export type EventEvidence = 'browser' | 'server';
export interface EventDefinitionInput { name: string; label: string; description: string | null; attributes: EventAttributeDef[]; evidence: EventEvidence }
export interface EventDefinition extends EventDefinitionInput { status: 'active' | 'archived'; createdAt: string; updatedAt: string }
export interface EventCoverage { platform: string; collectingSince: string }
export type FilterOp = 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'before' | 'after' | 'within_last_days' | 'within_next_days';
export type FilterValue = string | number | boolean | string[] | { fromTrigger: string };
export interface EventFilter { key: string; op: FilterOp; value: FilterValue }
export type EventWindow = { lastDays: number } | { from: string; to: string };
export type EventLeaf =
  | { kind: 'event'; name: string; measure: 'count' | { sum: string }; op: 'gte' | 'eq' | 'lte'; value: number; window: EventWindow; filters: EventFilter[] }
  | { kind: 'segment'; segmentId: string };
export type EventRule = { op: 'AND' | 'OR'; children: EventRule[] } | EventLeaf;
export interface EventTriggerConfig { eventName: string; filters: EventFilter[]; includeGuests: boolean }
export interface TriggerEvent { eventId: string; name: string; attributes: Record<string, unknown> }
export interface WaitingFor { stepId: string; eventName: string; filters: EventFilter[]; since: string }
export interface DynamicSegmentInput { name: string; description: string | null; rule: EventRule }
export interface DynamicSegment extends DynamicSegmentInput { id: string; createdBy: string | null; createdAt: string; updatedAt: string; issues: string[] }
export interface MarketingEventRow {
  eventId: string; deviceId: string; platform: string; source: string; name: string; attributes: Record<string, unknown>;
  companyId: string | null; branchId: string | null; actorKind: string | null; occurredAt: string; receivedAt: string;
  attributedUserId: string | null; attribution: string | null;
}
export interface EventDailyRow { date: string; name: string; platform: string; events: number; users: number; devices: number }
```

Change these existing declarations (whole lines replaced):

```ts
export type WorkflowStep =
  | { id: string; type: 'audience'; segmentIds?: string[]; excludeSegmentIds?: string[]; dynamicSegmentIds?: string[]; excludeDynamicSegmentIds?: string[]; eventRule?: EventRule | null; nextId: string | null }
  | { id: string; type: 'wait'; hours: number; minutes?: number; nextId: string | null }
  | { id: string; type: 'condition'; expression: string; yesNextId: string | null; noNextId: string | null }
  | { id: string; type: 'split'; branches: SplitBranch[] }
  | { id: string; type: 'action'; action: WorkflowAction; nextId: string | null }
  | { id: string; type: 'webhook'; method: WebhookMethod; url: string; headers: WebhookHeader[]; body?: string; nextId: string | null }
  | { id: string; type: 'wait_event'; eventName: string; filters: EventFilter[]; timeoutHours: number; timeoutMinutes?: number; matchedNextId: string | null; timeoutNextId: string | null }
  | { id: string; type: 'event_split'; rule: EventRule; yesNextId: string | null; noNextId: string | null };
export type TriggerType = 'scheduled' | 'order_milestone' | 'first_login' | 'app_login' | 'event';
export type TriggerConfig = ScheduledTriggerConfig | OrderMilestoneTriggerConfig | EventTriggerConfig | Record<string, never>;
export type ExitGoal = { kind: 'order_placed' } | { kind: 'event'; eventName: string; filters: EventFilter[] } | null;
export interface WorkflowAnalytics {
  counts: { enrolled: number; running: number; completed: number; skipped: number; failed: number; converted: number; holdout: number; enrolledGuests: number; mergedToUser: number };
  actions: { kind: string; status: string; count: number }[];
  splits: { stepId: string; branches: { branchId: string; label: string; entered: number; converted: number }[] }[];
  holdout: { enrolled: number; converted: number }; treated: { enrolled: number; converted: number };
}
export interface EnrollmentRow {
  id: string; userId: string | null; deviceId: string | null; status: string; occurrenceKey: string; currentStepId: string | null; resumeAt: string | null;
  isHoldout: boolean; isTest: boolean; startedAt: string; completedAt: string | null; endReason: string | null; convertedAt: string | null;
}
```

- [ ] **Step 2: Re-export and widen the domain types** — in `marketing-workflow/domain/workflow.types.ts`:

```ts
import type { WorkflowStep } from '@cp/marketing-workflow';
export type {
  CanvasPosition, ExitGoal, NotifyChannel, OrderMilestoneTriggerConfig, ScheduledTriggerConfig, SplitBranch, TriggerConfig,
  TriggerType, WebhookHeader, WebhookMethod, Workflow, WorkflowAction, WorkflowInput, WorkflowIssue, WorkflowSchedule,
  WorkflowStatus, WorkflowStep, WorkflowStepType, WorkflowListItem, WorkflowMeta, WorkflowRevision, WorkflowAnalytics,
  EnrollmentRow, ActionLogRow, WebhookSecretItem, WebhookTestResult, SegmentOption,
  EventFilter, EventRule, EventTriggerConfig, TriggerEvent, WaitingFor,
} from '@cp/marketing-workflow';

/** Same numbers as josh's editor / validator (MAX_MARKETING_WAIT_STEPS = 3, MAX_MARKETING_CONDITION_STEPS = 5). */
export const LIMITS = {
  maxWaitSteps: 3, maxConditionSteps: 5, maxAudienceSteps: 1, maxWaitMinutes: 30 * 24 * 60,
  maxHeaders: 20, maxBodyBytes: 16 * 1024, maxUrlLength: 1024, minSplitBranches: 2, maxSplitBranches: 4,
} as const;
export const TRIGGER_TYPES = ['scheduled', 'order_milestone', 'first_login', 'app_login', 'event'] as const;
export const NOTIFY_CHANNELS = ['push', 'email', 'in_app'] as const;
export const WEBHOOK_METHODS = ['POST', 'PUT', 'PATCH', 'GET'] as const;
/** Push to a guest device: at most this many per device per rolling 24 h, all workflows (spec §10). */
export const GUEST_PUSH_DAILY_CAP = 1;

/** Every outgoing pointer of a step, in port order (condition / event_split: yes, no · split: branch order · wait_event: matched, timeout). */
export function nextIdsOf(step: WorkflowStep): (string | null)[] {
  if (step.type === 'condition' || step.type === 'event_split') return [step.yesNextId, step.noNextId];
  if (step.type === 'split') return step.branches.map((b) => b.nextId);
  if (step.type === 'wait_event') return [step.matchedNextId, step.timeoutNextId];
  return [step.nextId];
}
```

- [ ] **Step 3: Write the migration** `apps/commerce-platform/src/migrations/1796400000000-MarketingEventLayer.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Seed catalog = shop-web's analytics events with scalar attributes only (no search free text, no item arrays). */
const SEED: { name: string; label: string; attributes: { key: string; type: string; label: string }[] }[] = [
  { name: 'view_item', label: 'ดูสินค้า', attributes: [
    { key: 'item_id', type: 'string', label: 'รหัสสินค้า' }, { key: 'item_name', type: 'string', label: 'ชื่อสินค้า' },
    { key: 'price', type: 'number', label: 'ราคา' }, { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'view_category', label: 'ดูหมวดสินค้า', attributes: [
    { key: 'category_name', type: 'string', label: 'หมวด' }, { key: 'category2_name', type: 'string', label: 'หมวดย่อย' },
    { key: 'category3_name', type: 'string', label: 'หมวดย่อยชั้น 3' }] },
  { name: 'search', label: 'ค้นหา', attributes: [{ key: 'search_type', type: 'string', label: 'วิธีค้นหา' }] },
  { name: 'add_to_cart', label: 'ใส่ตะกร้า', attributes: [
    { key: 'item_id', type: 'string', label: 'รหัสสินค้า' }, { key: 'item_name', type: 'string', label: 'ชื่อสินค้า' },
    { key: 'quantity', type: 'number', label: 'จำนวน' }, { key: 'price', type: 'number', label: 'ราคา' },
    { key: 'value', type: 'number', label: 'มูลค่า' }, { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'begin_checkout', label: 'เริ่มชำระเงิน', attributes: [
    { key: 'value', type: 'number', label: 'มูลค่า' }, { key: 'item_count', type: 'number', label: 'จำนวนรายการ' },
    { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'purchase', label: 'ซื้อ (จากหน้าเว็บ)', attributes: [
    { key: 'transaction_id', type: 'string', label: 'เลขที่ออเดอร์' }, { key: 'value', type: 'number', label: 'มูลค่า' },
    { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'login', label: 'เข้าสู่ระบบ', attributes: [] },
];

const monthStart = (d: Date, add: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
const partitionName = (d: Date) => `marketing_events_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Marketing event layer (spec 2026-10-10-marketing-event-layer §4, §13). */
export class MarketingEventLayer1796400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE marketing_event_definitions (
      name varchar(64) PRIMARY KEY, label varchar(120) NOT NULL, description text, attributes jsonb NOT NULL DEFAULT '[]',
      evidence varchar(8) NOT NULL DEFAULT 'browser', status varchar(10) NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT marketing_event_definitions_status CHECK (status IN ('active', 'archived')),
      CONSTRAINT marketing_event_definitions_evidence CHECK (evidence IN ('browser', 'server')))`);
    for (const d of SEED) {
      await q.query(`INSERT INTO marketing_event_definitions (name, label, attributes) VALUES ($1, $2, $3::jsonb)`, [d.name, d.label, JSON.stringify(d.attributes)]);
    }
    // bigserial, not IDENTITY: identity columns on partitioned tables need Postgres 17.
    await q.query(`CREATE TABLE marketing_events (
      id bigserial, schema_version smallint NOT NULL, event_id uuid NOT NULL, device_id varchar(64) NOT NULL, platform varchar(10) NOT NULL,
      source varchar(16) NOT NULL, environment varchar(16) NOT NULL, name varchar(64) NOT NULL, attributes jsonb NOT NULL DEFAULT '{}',
      company_id varchar(100), branch_id varchar(100), actor_kind varchar(10), occurred_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(), attributed_user_id uuid, attribution varchar(16),
      PRIMARY KEY (id, occurred_at), CONSTRAINT marketing_events_once UNIQUE (event_id, occurred_at)
    ) PARTITION BY RANGE (occurred_at)`);
    await q.query(`CREATE INDEX marketing_events_user ON marketing_events (attributed_user_id, name, occurred_at) WHERE attributed_user_id IS NOT NULL`);
    await q.query(`CREATE INDEX marketing_events_device ON marketing_events (device_id, occurred_at)`);
    await q.query(`CREATE TABLE marketing_events_default PARTITION OF marketing_events DEFAULT`);
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const from = monthStart(now, i); const to = monthStart(now, i + 1);
      await q.query(`CREATE TABLE ${partitionName(from)} PARTITION OF marketing_events FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`);
    }
    await q.query(`CREATE TABLE marketing_event_coverage (platform varchar(10) PRIMARY KEY, collecting_since timestamptz NOT NULL)`);
    await q.query(`CREATE TABLE marketing_devices (device_id varchar(64) PRIMARY KEY, platform varchar(10) NOT NULL, push_subscription_id uuid,
      first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE marketing_device_links (id bigserial PRIMARY KEY, device_id varchar(64) NOT NULL, user_id uuid NOT NULL,
      platform varchar(10) NOT NULL, linked_at timestamptz NOT NULL, is_staff boolean NOT NULL DEFAULT false,
      CONSTRAINT marketing_device_links_once UNIQUE (device_id, linked_at))`);
    await q.query(`CREATE INDEX marketing_device_links_user ON marketing_device_links (user_id)`);
    await q.query(`CREATE TABLE marketing_event_daily (date date NOT NULL, name varchar(64) NOT NULL, platform varchar(10) NOT NULL,
      events int NOT NULL, users int NOT NULL, devices int NOT NULL, PRIMARY KEY (date, name, platform))`);
    await q.query(`CREATE TABLE marketing_dynamic_segments (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar(155) NOT NULL,
      description text, rule jsonb NOT NULL, created_by varchar(128), created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE marketing_guest_push_log (id bigserial PRIMARY KEY, device_id varchar(64) NOT NULL, sent_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX marketing_guest_push_log_device ON marketing_guest_push_log (device_id, sent_at)`);
    // josh user_devices copy (device.snapshot; reference-copy version guard).
    await q.query(`CREATE TABLE josh_user_devices (id uuid PRIMARY KEY, user_id uuid, individual_id varchar(64), platform varchar(20),
      first_seen_at timestamptz, last_seen_at timestamptz, source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`ALTER TABLE marketing_workflow_enrollments ALTER COLUMN user_id DROP NOT NULL,
      ADD COLUMN device_id varchar(64), ADD COLUMN waiting_for jsonb, ADD COLUMN trigger_event jsonb,
      ADD CONSTRAINT marketing_workflow_enrollments_who CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)`);
    await q.query(`CREATE UNIQUE INDEX marketing_workflow_enrollments_guest_once ON marketing_workflow_enrollments (workflow_id, device_id, occurrence_key) WHERE user_id IS NULL`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_guest ON marketing_workflow_enrollments (device_id) WHERE user_id IS NULL AND status IN ('pending', 'running')`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_waiting ON marketing_workflow_enrollments ((waiting_for->>'eventName')) WHERE waiting_for IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM marketing_workflow_enrollments WHERE user_id IS NULL`);
    await q.query(`DROP INDEX marketing_workflow_enrollments_waiting`);
    await q.query(`DROP INDEX marketing_workflow_enrollments_guest`);
    await q.query(`DROP INDEX marketing_workflow_enrollments_guest_once`);
    await q.query(`ALTER TABLE marketing_workflow_enrollments DROP CONSTRAINT marketing_workflow_enrollments_who,
      DROP COLUMN trigger_event, DROP COLUMN waiting_for, DROP COLUMN device_id, ALTER COLUMN user_id SET NOT NULL`);
    for (const t of ['josh_user_devices', 'marketing_guest_push_log', 'marketing_dynamic_segments', 'marketing_event_daily', 'marketing_device_links',
      'marketing_devices', 'marketing_event_coverage', 'marketing_events', 'marketing_event_definitions']) {
      await q.query(`DROP TABLE ${t}`); // dropping marketing_events drops its partitions
    }
  }
}
```

- [ ] **Step 4: Write the two entities**

`marketing-events/infrastructure/marketing-event-definition.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { EventAttributeDef, EventEvidence } from '@cp/marketing-workflow';

/** The event catalog (spec §4, §14): ingest accepts only these names and declared attributes. */
@Entity('marketing_event_definitions')
export class MarketingEventDefinitionRow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) name: string;
  @Column({ type: 'varchar', length: 120 }) label: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) attributes: EventAttributeDef[];
  @Column({ type: 'varchar', length: 8, default: 'browser' }) evidence: EventEvidence;
  @Column({ type: 'varchar', length: 10, default: 'active' }) status: 'active' | 'archived';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

`marketing-events/infrastructure/marketing-dynamic-segment.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { EventRule } from '@cp/marketing-workflow';

/** A named event rule, evaluated live in commerce only — never frozen, never sent to josh (spec §11). */
@Entity('marketing_dynamic_segments')
export class MarketingDynamicSegmentRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 155 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'jsonb' }) rule: EventRule;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

- [ ] **Step 5: Type-check and run the migration**

Run: `npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json`
Expected: errors only where later tasks change code (`workflow.validator.ts` / `workflow-engine.service.ts` exhaustive switches over `WorkflowStep`, `EnrollmentRecord.userId` users). If tsc fails on anything else, fix it. Record the remaining errors; Tasks 9–11 remove them.

Run: `npm run migration:run` then `psql "$DATABASE_URL" -c '\d+ marketing_events'` — expect a partitioned table with 4 partitions (default + 3 months). Revert once and re-run to prove `down()` (`npm run migration:revert` if present in root `package.json`, else `npx typeorm migration:revert -d apps/commerce-platform/src/config/data-source.ts`). Check Postgres ≥ 12 with `SELECT version()`; record it. No local DB → write "migration not run locally" in the task report.

- [ ] **Step 6: Commit**

```bash
git add libs/marketing-workflow/src/index.d.ts apps/commerce-platform/src/migrations/1796400000000-MarketingEventLayer.ts \
  apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/*.entity.ts \
  apps/commerce-platform/src/modules/integration/marketing-workflow/domain/workflow.types.ts
git commit -m "feat(marketing-events): event layer tables, partitions, shared types"
```

### Task 2: Event catalog rules

**Files:**
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/domain/event-catalog.ts`
- Test: `apps/commerce-platform/src/modules/integration/marketing-events/domain/event-catalog.spec.ts`

**Interfaces:**
- Produces: `EVENT_NAME`, `ATTRIBUTE_KEY`, `DEVICE_ID`, `isPiiKey(key): boolean`, `definitionIssues(input: EventDefinitionInput, existing?: EventDefinition): string[]`, `type Rejection`, `normalizeEvent(def: EventDefinition | undefined, raw: { occurredAt: string; attributes?: Record<string, unknown> }, now: Date): { ok: true; occurredAt: Date; attributes: Record<string, string | number | boolean> } | { ok: false; reason: Rejection }`.

- [ ] **Step 1: Write the failing test**

```ts
import type { EventDefinition } from '@cp/marketing-workflow';
import { definitionIssues, isPiiKey, normalizeEvent } from './event-catalog';

const def: EventDefinition = {
  name: 'add_to_cart', label: 'ใส่ตะกร้า', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [
    { key: 'item_id', type: 'string', label: '' }, { key: 'price', type: 'number', label: '' },
    { key: 'gift', type: 'boolean', label: '' }, { key: 'deliver_on', type: 'date', label: '' }, { key: 'old', type: 'string', label: '', archived: true },
  ],
};
const now = new Date('2026-10-10T10:00:00Z');

describe('event catalog', () => {
  it('rejects PII attribute names in any case or dash form', () => {
    expect(isPiiKey('Email')).toBe(true);
    expect(isPiiKey('first-name')).toBe(true);
    expect(isPiiKey('item_id')).toBe(false);
    expect(definitionIssues({ name: 'x_y', label: 'X', description: null, evidence: 'browser', attributes: [{ key: 'phone', type: 'string', label: '' }] }))
      .toEqual(['attribute "phone": ห้ามเก็บข้อมูลส่วนบุคคล']);
  });

  it('keeps name and attribute types fixed once created', () => {
    const issues = definitionIssues({ ...def, attributes: [{ key: 'item_id', type: 'number', label: '' }] }, def);
    expect(issues).toContain('เปลี่ยนชนิดของ "item_id" ไม่ได้');
    expect(issues).toContain('ลบ attribute "price" ไม่ได้ (archive แทน)');
  });

  it('keeps declared attributes, drops undeclared and archived ones, normalises dates', () => {
    const r = normalizeEvent(def, { occurredAt: '2026-10-10T16:59:00+07:00', attributes: { item_id: 'SKU-1', price: 199.5, gift: false, deliver_on: '2026-10-12', extra: 'x', old: 'y' } }, now);
    expect(r).toEqual({ ok: true, occurredAt: new Date('2026-10-10T09:59:00Z'),
      attributes: { item_id: 'SKU-1', price: 199.5, gift: false, deliver_on: '2026-10-12T00:00:00.000Z' } });
  });

  it.each([
    [{ price: '199' }, 'bad_attribute_type'],
    [{ price: { $gt: 1 } }, 'bad_attribute_type'],
    [{ item_id: "x'); DROP TABLE marketing_events;--".padEnd(501, 'x') }, 'bad_attribute_type'],
    [Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])), 'too_large'],
    [{ item_id: 'x'.repeat(2100) }, 'too_large'],
  ])('rejects %j as %s', (attributes, reason) => {
    expect(normalizeEvent(def, { occurredAt: now.toISOString(), attributes }, now)).toEqual({ ok: false, reason });
  });

  it('rejects unknown, archived, future and stale events', () => {
    expect(normalizeEvent(undefined, { occurredAt: now.toISOString() }, now)).toEqual({ ok: false, reason: 'unknown_event' });
    expect(normalizeEvent({ ...def, status: 'archived' }, { occurredAt: now.toISOString() }, now)).toEqual({ ok: false, reason: 'archived_event' });
    expect(normalizeEvent(def, { occurredAt: '2026-10-10T10:06:00Z' }, now)).toEqual({ ok: false, reason: 'in_future' });
    expect(normalizeEvent(def, { occurredAt: '2026-10-03T09:59:00Z' }, now)).toEqual({ ok: false, reason: 'too_old' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-events/domain/event-catalog`
Expected: FAIL — `Cannot find module './event-catalog'`.

- [ ] **Step 3: Implement** `event-catalog.ts`:

```ts
import type { EventDefinition, EventDefinitionInput } from '@cp/marketing-workflow';

export const EVENT_NAME = /^[a-z][a-z0-9_]{1,63}$/;
export const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** josh `user_devices.individual_id` (varchar 64): web = 32 hex chars, mobile = OneSignal subscription id. */
export const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_ATTRIBUTES = 20;
export const MAX_ATTRIBUTE_BYTES = 2048;
export const MAX_STRING = 500;
export const MAX_FUTURE_MS = 5 * 60_000;
export const MAX_AGE_MS = 7 * 86_400_000;
const TYPES = ['string', 'number', 'boolean', 'date'];
const PII = new Set(['email', 'phone', 'tel', 'mobile', 'name', 'first_name', 'last_name', 'address', 'id_card', 'citizen_id', 'password', 'token']);

export const isPiiKey = (key: string) => PII.has(key.toLowerCase().replace(/-/g, '_'));

/** Why a definition can't be saved (spec §14). `existing` = the stored one: name and attribute types never change. */
export function definitionIssues(d: EventDefinitionInput, existing?: EventDefinition): string[] {
  const out: string[] = [];
  if (!EVENT_NAME.test(d.name ?? '')) out.push('ชื่อ event ใช้ a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร (2–64 ตัว)');
  if (!d.label?.trim() || d.label.length > 120) out.push('ตั้งชื่อที่แสดง (ไม่เกิน 120 ตัวอักษร)');
  if (d.evidence !== 'browser' && d.evidence !== 'server') out.push('evidence ต้องเป็น browser หรือ server');
  if (!Array.isArray(d.attributes) || d.attributes.length > MAX_ATTRIBUTES) out.push(`attribute ได้ไม่เกิน ${MAX_ATTRIBUTES} ตัว`);
  const keys = new Set<string>();
  for (const a of d.attributes ?? []) {
    if (!ATTRIBUTE_KEY.test(a.key ?? '')) out.push(`attribute "${a.key}": ใช้ a-z 0-9 _ (ไม่เกิน 40 ตัว)`);
    else if (isPiiKey(a.key)) out.push(`attribute "${a.key}": ห้ามเก็บข้อมูลส่วนบุคคล`);
    if (!TYPES.includes(a.type)) out.push(`attribute "${a.key}": ชนิดไม่ถูกต้อง`);
    if (keys.has(a.key)) out.push(`attribute "${a.key}" ซ้ำ`);
    keys.add(a.key);
  }
  if (existing) {
    if (existing.name !== d.name) out.push('เปลี่ยนชื่อ event ไม่ได้');
    for (const old of existing.attributes) {
      const next = d.attributes.find((a) => a.key === old.key);
      if (!next) out.push(`ลบ attribute "${old.key}" ไม่ได้ (archive แทน)`);
      else if (next.type !== old.type) out.push(`เปลี่ยนชนิดของ "${old.key}" ไม่ได้`);
    }
  }
  return out;
}

export type Rejection = 'unknown_event' | 'archived_event' | 'bad_attribute_type' | 'too_large' | 'in_future' | 'too_old';
export type Normalized = { ok: true; occurredAt: Date; attributes: Record<string, string | number | boolean> } | { ok: false; reason: Rejection };

/** One incoming event against its definition (spec §3): declared, non-archived attributes only, types checked, dates as ISO UTC. */
export function normalizeEvent(def: EventDefinition | undefined, raw: { occurredAt: string; attributes?: Record<string, unknown> }, now: Date): Normalized {
  if (!def) return { ok: false, reason: 'unknown_event' };
  if (def.status !== 'active') return { ok: false, reason: 'archived_event' };
  const at = new Date(raw.occurredAt);
  if (at.getTime() > now.getTime() + MAX_FUTURE_MS) return { ok: false, reason: 'in_future' };
  if (at.getTime() < now.getTime() - MAX_AGE_MS) return { ok: false, reason: 'too_old' };
  const input = raw.attributes ?? {};
  if (Object.keys(input).length > MAX_ATTRIBUTES || Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_ATTRIBUTE_BYTES) return { ok: false, reason: 'too_large' };
  const attributes: Record<string, string | number | boolean> = {};
  for (const a of def.attributes) {
    if (a.archived || !Object.prototype.hasOwnProperty.call(input, a.key) || input[a.key] === null) continue;
    const v = input[a.key];
    if (a.type === 'string' && typeof v === 'string' && v.length <= MAX_STRING) attributes[a.key] = v;
    else if (a.type === 'number' && typeof v === 'number' && Number.isFinite(v)) attributes[a.key] = v;
    else if (a.type === 'boolean' && typeof v === 'boolean') attributes[a.key] = v;
    else if (a.type === 'date' && typeof v === 'string' && !Number.isNaN(Date.parse(v))) attributes[a.key] = new Date(v).toISOString();
    else return { ok: false, reason: 'bad_attribute_type' };
  }
  return { ok: true, occurredAt: at, attributes };
}
```

- [ ] **Step 4: Run the test** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-events/domain/event-catalog*
git commit -m "feat(marketing-events): catalog rules and event normalisation"
```

### Task 3: Attribute filters

**Files:**
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/domain/event-filter.ts`
- Test: `apps/commerce-platform/src/modules/integration/marketing-events/domain/event-filter.spec.ts`

**Interfaces:**
- Produces: `type Types = Record<string, EventAttributeType>`, `OPS_BY_TYPE`, `isFromTrigger(v): v is { fromTrigger: string }`, `filterIssues(filters: EventFilter[], types: Types, triggerTypes: Types | null): string[]`, `matchesFilters(attributes: Record<string, unknown>, filters: EventFilter[], types: Types, trigger?: Record<string, unknown> | null, now?: Date): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import type { EventFilter } from '@cp/marketing-workflow';
import { filterIssues, matchesFilters, type Types } from './event-filter';

const types: Types = { item_id: 'string', price: 'number', gift: 'boolean', deliver_on: 'date', order_id: 'string' };
const now = new Date('2026-10-10T10:00:00Z');
const m = (attrs: Record<string, unknown>, filters: EventFilter[], trigger: Record<string, unknown> | null = null) => matchesFilters(attrs, filters, types, trigger, now);

describe('event filters', () => {
  it('compares by type and fails on a missing attribute', () => {
    expect(m({ price: 600 }, [{ key: 'price', op: 'gte', value: 500 }])).toBe(true);
    expect(m({ price: 400 }, [{ key: 'price', op: 'gte', value: 500 }])).toBe(false);
    expect(m({}, [{ key: 'price', op: 'neq', value: 500 }])).toBe(false);
    expect(m({ item_id: 'SKU-12' }, [{ key: 'item_id', op: 'contains', value: 'SKU' }])).toBe(true);
    expect(m({ item_id: 'B' }, [{ key: 'item_id', op: 'in', value: ['A', 'B'] }])).toBe(true);
    expect(m({ gift: true }, [{ key: 'gift', op: 'eq', value: true }])).toBe(true);
    expect(m({ deliver_on: '2026-10-08T00:00:00Z' }, [{ key: 'deliver_on', op: 'within_last_days', value: 3 }])).toBe(true);
    expect(m({ deliver_on: '2026-10-12T00:00:00Z' }, [{ key: 'deliver_on', op: 'within_next_days', value: 1 }])).toBe(false);
    expect(m({ deliver_on: '2026-10-01T00:00:00Z' }, [{ key: 'deliver_on', op: 'before', value: '2026-10-02' }])).toBe(true);
  });

  it('matches across events with fromTrigger, and fails when the trigger lacks the value', () => {
    const f: EventFilter[] = [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }];
    expect(m({ order_id: 'O1' }, f, { order_id: 'O1' })).toBe(true);
    expect(m({ order_id: 'O2' }, f, { order_id: 'O1' })).toBe(false);
    expect(m({ order_id: 'O1' }, f, {})).toBe(false);
    expect(m({ order_id: 'O1' }, f, null)).toBe(false);
  });

  it('validates keys, ops, values and fromTrigger use', () => {
    expect(filterIssues([{ key: 'nope', op: 'eq', value: 'x' }], types, null)).toEqual(['ไม่มี attribute "nope"']);
    expect(filterIssues([{ key: 'price', op: 'contains', value: 1 }], types, null)).toEqual(['"price" ใช้ contains ไม่ได้']);
    expect(filterIssues([{ key: 'price', op: 'gt', value: '1' }], types, null)).toEqual(['"price": ค่าไม่ถูกต้อง']);
    expect(filterIssues([{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], types, null))
      .toEqual(['"order_id": ค่าจาก event ที่ trigger ใช้ได้เฉพาะ workflow ที่เริ่มด้วย event']);
    expect(filterIssues([{ key: 'order_id', op: 'eq', value: { fromTrigger: 'price' } }], types, { price: 'number' }))
      .toEqual(['"order_id": attribute "price" ของ event ที่ trigger ไม่มีหรือชนิดไม่ตรง']);
    expect(filterIssues(Array.from({ length: 11 }, () => ({ key: 'gift', op: 'eq' as const, value: true })), types, null))
      .toEqual(['เงื่อนไข attribute ได้ไม่เกิน 10 ข้อ']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-events/domain/event-filter`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `event-filter.ts`:

```ts
import type { EventAttributeType, EventFilter, FilterOp, FilterValue } from '@cp/marketing-workflow';

export type Types = Record<string, EventAttributeType>;
export const MAX_FILTERS = 10;
export const OPS_BY_TYPE: Record<EventAttributeType, FilterOp[]> = {
  string: ['eq', 'neq', 'contains', 'in'], number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], boolean: ['eq'],
  date: ['before', 'after', 'within_last_days', 'within_next_days'],
};
/** Ops that compare against one value, so they can take a value from the trigger event. */
const TRIGGER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'before', 'after'];
const DAY = 86_400_000;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export const isFromTrigger = (v: unknown): v is { fromTrigger: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { fromTrigger?: unknown }).fromTrigger === 'string';

/** Staff-facing problems with a filter list (spec §6). `triggerTypes` = the trigger event's attributes, null when fromTrigger is not allowed. */
export function filterIssues(filters: EventFilter[], types: Types, triggerTypes: Types | null): string[] {
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS) return [`เงื่อนไข attribute ได้ไม่เกิน ${MAX_FILTERS} ข้อ`];
  const out: string[] = [];
  for (const f of filters) {
    const type = own(types, f.key) ? types[f.key] : undefined;
    if (!type) { out.push(`ไม่มี attribute "${f.key}"`); continue; }
    if (!OPS_BY_TYPE[type].includes(f.op)) { out.push(`"${f.key}" ใช้ ${f.op} ไม่ได้`); continue; }
    if (isFromTrigger(f.value)) {
      if (!triggerTypes) out.push(`"${f.key}": ค่าจาก event ที่ trigger ใช้ได้เฉพาะ workflow ที่เริ่มด้วย event`);
      else if (!TRIGGER_OPS.includes(f.op)) out.push(`"${f.key}": ${f.op} ใช้ค่าจาก event ที่ trigger ไม่ได้`);
      else if (!own(triggerTypes, f.value.fromTrigger) || triggerTypes[f.value.fromTrigger] !== type)
        out.push(`"${f.key}": attribute "${f.value.fromTrigger}" ของ event ที่ trigger ไม่มีหรือชนิดไม่ตรง`);
      continue;
    }
    if (!valueFits(type, f.op, f.value)) out.push(`"${f.key}": ค่าไม่ถูกต้อง`);
  }
  return out;
}

function valueFits(type: EventAttributeType, op: FilterOp, v: FilterValue): boolean {
  if (op === 'in') return Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 500);
  if (op === 'within_last_days' || op === 'within_next_days') return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 365;
  if (type === 'string') return typeof v === 'string' && v.length <= 500;
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'boolean') return typeof v === 'boolean';
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/** All filters pass (AND). A missing attribute — or a fromTrigger value the trigger event lacks — fails the filter. */
export function matchesFilters(attributes: Record<string, unknown>, filters: EventFilter[], types: Types,
  trigger: Record<string, unknown> | null = null, now = new Date()): boolean {
  return filters.every((f) => matchOne(attributes[f.key], f, own(types, f.key) ? types[f.key] : undefined, trigger, now));
}

function matchOne(actual: unknown, f: EventFilter, type: EventAttributeType | undefined, trigger: Record<string, unknown> | null, now: Date): boolean {
  if (actual === undefined || actual === null || !type) return false;
  const expected = isFromTrigger(f.value) ? trigger?.[f.value.fromTrigger] : f.value;
  if (expected === undefined || expected === null) return false;
  if (type === 'string') {
    if (typeof actual !== 'string') return false;
    if (f.op === 'in') return Array.isArray(expected) && expected.includes(actual);
    if (f.op === 'contains') return typeof expected === 'string' && actual.includes(expected);
    return f.op === 'eq' ? actual === expected : f.op === 'neq' ? actual !== expected : false;
  }
  if (type === 'number') return typeof actual === 'number' && typeof expected === 'number' && compare(actual, expected, f.op);
  if (type === 'boolean') return f.op === 'eq' && actual === expected;
  const at = Date.parse(String(actual));
  if (Number.isNaN(at)) return false;
  if (f.op === 'within_last_days') return at <= now.getTime() && at >= now.getTime() - Number(expected) * DAY;
  if (f.op === 'within_next_days') return at >= now.getTime() && at <= now.getTime() + Number(expected) * DAY;
  const e = Date.parse(String(expected));
  if (Number.isNaN(e)) return false;
  return f.op === 'before' ? at < e : f.op === 'after' ? at > e : false;
}

const compare = (a: number, b: number, op: FilterOp) =>
  op === 'eq' ? a === b : op === 'neq' ? a !== b : op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : op === 'lte' ? a <= b : false;
```

- [ ] **Step 4: Run the test** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-events/domain/event-filter*
git commit -m "feat(marketing-events): attribute filters (validation + match, fromTrigger)"
```

### Task 4: Attribution and event rules

**Files:**
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/domain/attribution.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/domain/event-rule.ts`
- Test: `.../domain/attribution.spec.ts`, `.../domain/event-rule.spec.ts`

**Interfaces:**
- Consumes: `filterIssues`, `isFromTrigger`, `Types` (Task 3).
- Produces:
  - `interface DeviceLink { userId: string; linkedAt: Date; isStaff: boolean }`, `linkAt(links: DeviceLink[], at: Date): DeviceLink | null` (links sorted by `linkedAt` ascending), `type Attribution = { userId: string | null; attribution: 'device_link' | 'staff' | 'no_consent' | null }`, `attributeEvent(link: DeviceLink | null, usable: (userId: string) => boolean, actorKind?: string | null): Attribution`.
  - `RULE_LIMITS`, `interface RuleContext { catalog: Map<string, EventDefinition>; coverageStart: Date | null; segmentIds: Set<string> | null; now: Date }`, `typesOf(def: EventDefinition): Types`, `windowStart(w: EventWindow, now: Date): Date | null`, `ruleIssues(rule: EventRule, ctx: RuleContext): string[]`, `compileRule(rule: EventRule, refs: { catalog: Map<string, EventDefinition>; segments: Map<string, EventRule> }, userSql: '$1::uuid' | 'u.id', params: unknown[]): string`, `segmentIdsIn(rule: EventRule): string[]`, `eventRefsIn(value: unknown): Map<string, Set<string>>` (event name → attribute keys used anywhere in a workflow / rule JSON).

- [ ] **Step 1: Write the failing tests**

`attribution.spec.ts`:

```ts
import { attributeEvent, linkAt, type DeviceLink } from './attribution';

const t = (h: number) => new Date(Date.UTC(2026, 9, 10, h));
const links: DeviceLink[] = [{ userId: 'A', linkedAt: t(10), isStaff: false }, { userId: 'B', linkedAt: t(14), isStaff: false }];

describe('attribution (guest → A → B)', () => {
  it('gives guest events to the first login, then follows the link in force', () => {
    expect(linkAt(links, t(8))?.userId).toBe('A');
    expect(linkAt(links, t(10))?.userId).toBe('A');
    expect(linkAt(links, t(13))?.userId).toBe('A');
    expect(linkAt(links, t(14))?.userId).toBe('B');
    expect(linkAt([], t(8))).toBeNull();
  });

  it('never attributes to staff or to a user without consent', () => {
    const usable = (u: string) => u === 'A';
    expect(attributeEvent(links[0], usable)).toEqual({ userId: 'A', attribution: 'device_link' });
    expect(attributeEvent(links[1], usable)).toEqual({ userId: null, attribution: 'no_consent' });
    expect(attributeEvent({ ...links[0], isStaff: true }, usable)).toEqual({ userId: null, attribution: 'staff' });
    expect(attributeEvent(links[0], usable, 'staff')).toEqual({ userId: null, attribution: 'staff' });
    expect(attributeEvent(null, usable)).toEqual({ userId: null, attribution: null });
  });
});
```

`event-rule.spec.ts`:

```ts
import type { EventDefinition, EventRule } from '@cp/marketing-workflow';
import { compileRule, eventRefsIn, ruleIssues, segmentIdsIn, type RuleContext } from './event-rule';

const def: EventDefinition = { name: 'add_to_cart', label: '', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'price', type: 'number', label: '' }, { key: 'item_id', type: 'string', label: '' }] };
const catalog = new Map([[def.name, def]]);
const now = new Date('2026-10-10T00:00:00Z');
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({ catalog, coverageStart: new Date('2026-08-01T00:00:00Z'), segmentIds: new Set(['s1']), now, ...over });
const leaf = (over: object = {}): EventRule => ({ kind: 'event', name: 'add_to_cart', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [], ...over }) as EventRule;

describe('event rules', () => {
  it('accepts a valid nested rule', () => {
    expect(ruleIssues({ op: 'AND', children: [leaf(), { op: 'OR', children: [leaf({ measure: { sum: 'price' }, value: 500 }), { kind: 'segment', segmentId: 's1' }] }] }, ctx())).toEqual([]);
  });

  it('rejects a window before coverage instead of counting the gap as zero', () => {
    expect(ruleIssues(leaf({ op: 'eq', value: 0, window: { lastDays: 30 } }), ctx({ coverageStart: new Date('2026-10-08T00:00:00Z') })))
      .toEqual(['เริ่มเก็บ event เมื่อ 2026-10-08 — ช่วงเวลาต้องไม่ย้อนก่อนวันนั้น']);
    expect(ruleIssues(leaf(), ctx({ coverageStart: null }))).toEqual(['ยังไม่เริ่มเก็บ event — ใช้เงื่อนไขนี้ได้หลังมี event เข้ามา']);
  });

  it('rejects sum on a non-number, unknown events, segment refs where not allowed, too deep / too many', () => {
    expect(ruleIssues(leaf({ measure: { sum: 'item_id' } }), ctx())).toContain('ผลรวมต้องใช้ attribute ชนิดตัวเลข');
    expect(ruleIssues(leaf({ name: 'nope' }), ctx())).toEqual(['ไม่มี event "nope" ใน catalog']);
    expect(ruleIssues({ kind: 'segment', segmentId: 's1' }, ctx({ segmentIds: null }))).toEqual(['dynamic segment ใช้ซ้อนใน dynamic segment ไม่ได้']);
    const deep: EventRule = { op: 'AND', children: [{ op: 'AND', children: [{ op: 'AND', children: [{ op: 'AND', children: [leaf()] }] }] }] };
    expect(ruleIssues(deep, ctx())).toEqual(['เงื่อนไขซ้อนลึกเกิน 4 ชั้น']);
    expect(ruleIssues({ op: 'OR', children: Array.from({ length: 17 }, () => leaf()) }, ctx())).toEqual(['เงื่อนไขได้ไม่เกิน 16 ข้อ']);
    expect(ruleIssues(leaf({ filters: [{ key: 'price', op: 'eq', value: { fromTrigger: 'price' } }] }), ctx())).toEqual(['ใน event rule ใช้ค่าจาก event ที่ trigger ไม่ได้']);
  });

  it('compiles to SQL where keys and values are parameters', () => {
    const params: unknown[] = ['user'];
    const sql = compileRule({ op: 'AND', children: [
      leaf({ filters: [{ key: 'item_id', op: 'eq', value: "x' OR 1=1 --" }] }),
      leaf({ measure: { sum: 'price' }, op: 'lte', value: 500, window: { from: '2026-09-15T00:00:00Z', to: '2026-10-01T00:00:00Z' } }),
      { kind: 'segment', segmentId: 's1' },
    ] }, { catalog, segments: new Map([['s1', leaf()]]) }, '$1::uuid', params);
    expect(sql).not.toContain("x'");
    expect(sql).not.toContain('item_id');
    expect(sql).toContain('e.attributed_user_id = $1::uuid');
    expect(sql).toContain('COALESCE(sum((e.attributes->>$');
    expect(params).toEqual(['user', 'add_to_cart', 7, 'item_id', "x' OR 1=1 --", 1, 'add_to_cart', '2026-09-15T00:00:00Z', '2026-10-01T00:00:00Z', 'price', 500,
      'add_to_cart', 7, 1]);
  });

  it('compiles an unknown event or segment to FALSE', () => {
    expect(compileRule(leaf({ name: 'gone' }), { catalog, segments: new Map() }, 'u.id', [])).toBe('FALSE');
    expect(compileRule({ kind: 'segment', segmentId: 'x' }, { catalog, segments: new Map() }, 'u.id', [])).toBe('FALSE');
  });

  it('finds segment ids and event references anywhere in workflow JSON', () => {
    expect(segmentIdsIn({ op: 'OR', children: [{ kind: 'segment', segmentId: 's1' }, leaf()] })).toEqual(['s1']);
    const refs = eventRefsIn({ triggerConfig: { eventName: 'login', filters: [] },
      steps: [{ type: 'wait_event', eventName: 'add_to_cart', filters: [{ key: 'item_id', op: 'eq', value: 'x' }] },
        { type: 'event_split', rule: leaf({ measure: { sum: 'price' } }) }] });
    expect([...refs.keys()].sort()).toEqual(['add_to_cart', 'login']);
    expect([...refs.get('add_to_cart')!].sort()).toEqual(['item_id', 'price']);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-events/domain/attribution marketing-events/domain/event-rule`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `attribution.ts`:

```ts
export interface DeviceLink { userId: string; linkedAt: Date; isStaff: boolean }
export type Attribution = { userId: string | null; attribution: 'device_link' | 'staff' | 'no_consent' | null };

/**
 * The link in force when an event happened (spec §5): the latest at or before it; before the device's first link →
 * the first link (guest browsing belongs to whoever logs in first). `links` sorted by linkedAt ascending.
 */
export function linkAt(links: DeviceLink[], at: Date): DeviceLink | null {
  let found: DeviceLink | null = null;
  for (const l of links) {
    if (l.linkedAt.getTime() <= at.getTime()) found = l;
    else break;
  }
  return found ?? links[0] ?? null;
}

/** Staff are never a customer; a user without consent is stored but not attributed (spec §5, §5.1). */
export function attributeEvent(link: DeviceLink | null, usable: (userId: string) => boolean, actorKind?: string | null): Attribution {
  if (actorKind === 'staff' || link?.isStaff) return { userId: null, attribution: 'staff' };
  if (!link) return { userId: null, attribution: null };
  return usable(link.userId) ? { userId: link.userId, attribution: 'device_link' } : { userId: null, attribution: 'no_consent' };
}
```

Implement `event-rule.ts`:

```ts
import type { EventDefinition, EventFilter, EventLeaf, EventRule, EventWindow } from '@cp/marketing-workflow';
import { filterIssues, isFromTrigger, type Types } from './event-filter';

export const RULE_LIMITS = { maxDepth: 4, maxLeaves: 16, maxDays: 90, maxCount: 1000 } as const;
const DAY = 86_400_000;

/** segmentIds: dynamic segments that exist; null = segment references are not allowed here (inside a dynamic segment). */
export interface RuleContext { catalog: Map<string, EventDefinition>; coverageStart: Date | null; segmentIds: Set<string> | null; now: Date }

export const typesOf = (def: EventDefinition): Types =>
  Object.fromEntries(def.attributes.filter((a) => !a.archived).map((a) => [a.key, a.type]));
const isGroup = (n: EventRule): n is { op: 'AND' | 'OR'; children: EventRule[] } => !!n && typeof n === 'object' && 'children' in n;

export function windowStart(w: EventWindow, now: Date): Date | null {
  if (w && 'lastDays' in w) {
    return Number.isInteger(w.lastDays) && w.lastDays >= 1 && w.lastDays <= RULE_LIMITS.maxDays ? new Date(now.getTime() - w.lastDays * DAY) : null;
  }
  if (w && 'from' in w) {
    const a = Date.parse(w.from); const b = Date.parse(w.to);
    if (Number.isNaN(a) || Number.isNaN(b) || a >= b || a < now.getTime() - RULE_LIMITS.maxDays * DAY || b > now.getTime() + DAY) return null;
    return new Date(a);
  }
  return null;
}

/** Staff-facing problems (spec §11). Coverage: a window may not start before commerce began collecting events. */
export function ruleIssues(rule: EventRule, ctx: RuleContext): string[] {
  const out: string[] = [];
  let leaves = 0;
  const visit = (n: EventRule, depth: number): void => {
    if (depth > RULE_LIMITS.maxDepth) { out.push(`เงื่อนไขซ้อนลึกเกิน ${RULE_LIMITS.maxDepth} ชั้น`); return; }
    if (!n || typeof n !== 'object') { out.push('เงื่อนไขไม่ถูกต้อง'); return; }
    if (isGroup(n)) {
      if ((n.op !== 'AND' && n.op !== 'OR') || !Array.isArray(n.children) || !n.children.length) { out.push('กลุ่มเงื่อนไขต้องมีอย่างน้อย 1 ข้อ'); return; }
      for (const c of n.children) visit(c, depth + 1);
      return;
    }
    if (++leaves > RULE_LIMITS.maxLeaves) { out.push(`เงื่อนไขได้ไม่เกิน ${RULE_LIMITS.maxLeaves} ข้อ`); return; }
    leafIssues(n, ctx, out);
  };
  visit(rule, 1);
  return [...new Set(out)];
}

function leafIssues(l: EventLeaf, ctx: RuleContext, out: string[]): void {
  if (l.kind === 'segment') {
    if (!ctx.segmentIds) out.push('dynamic segment ใช้ซ้อนใน dynamic segment ไม่ได้');
    else if (!ctx.segmentIds.has(l.segmentId)) out.push('ไม่พบ dynamic segment');
    return;
  }
  if (l.kind !== 'event') { out.push('เงื่อนไขไม่ถูกต้อง'); return; }
  const def = ctx.catalog.get(l.name);
  if (!def || def.status !== 'active') { out.push(`ไม่มี event "${l.name}" ใน catalog`); return; }
  const types = typesOf(def);
  if (l.measure !== 'count' && (!l.measure || typeof l.measure !== 'object' || types[l.measure.sum] !== 'number')) out.push('ผลรวมต้องใช้ attribute ชนิดตัวเลข');
  if (!['gte', 'eq', 'lte'].includes(l.op)) out.push('เปรียบเทียบได้เฉพาะ ≥ = ≤');
  const valueOk = l.measure === 'count'
    ? Number.isInteger(l.value) && l.value >= 0 && l.value <= RULE_LIMITS.maxCount
    : typeof l.value === 'number' && Number.isFinite(l.value);
  if (!valueOk) out.push('จำนวนไม่ถูกต้อง');
  const start = windowStart(l.window, ctx.now);
  if (!start) out.push('ช่วงเวลาไม่ถูกต้อง (1–90 วันล่าสุด)');
  else if (!ctx.coverageStart) out.push('ยังไม่เริ่มเก็บ event — ใช้เงื่อนไขนี้ได้หลังมี event เข้ามา');
  else if (start.getTime() < ctx.coverageStart.getTime()) out.push(`เริ่มเก็บ event เมื่อ ${ctx.coverageStart.toISOString().slice(0, 10)} — ช่วงเวลาต้องไม่ย้อนก่อนวันนั้น`);
  if (!Array.isArray(l.filters)) out.push('เงื่อนไข attribute ไม่ถูกต้อง');
  else if (l.filters.some((f) => isFromTrigger(f.value))) out.push('ใน event rule ใช้ค่าจาก event ที่ trigger ไม่ได้');
  else out.push(...filterIssues(l.filters, types, null));
}

const LEAF_CMP = { gte: '>=', eq: '=', lte: '<=' } as const;
const NUM_CMP: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

/**
 * One SQL boolean for the rule. `userSql` is chosen by the caller from two fixed strings; every key and value is a bound
 * parameter appended to `params`. An event or segment that no longer exists compiles to FALSE.
 */
export function compileRule(rule: EventRule, refs: { catalog: Map<string, EventDefinition>; segments: Map<string, EventRule> },
  userSql: '$1::uuid' | 'u.id', params: unknown[]): string {
  const p = (v: unknown, cast = '') => { params.push(v); return `$${params.length}${cast}`; };
  const node = (n: EventRule): string => {
    if (isGroup(n)) return `(${n.children.map(node).join(n.op === 'AND' ? ' AND ' : ' OR ')})`;
    if (n.kind === 'segment') { const r = refs.segments.get(n.segmentId); return r ? node(r) : 'FALSE'; }
    const def = refs.catalog.get(n.name);
    if (!def) return 'FALSE';
    const types = typesOf(def);
    const where = [`e.attributed_user_id = ${userSql}`, `e.name = ${p(n.name)}`];
    if ('lastDays' in n.window) where.push(`e.occurred_at >= now() - make_interval(days => ${p(n.window.lastDays, '::int')})`);
    else where.push(`e.occurred_at >= ${p(n.window.from, '::timestamptz')}`, `e.occurred_at < ${p(n.window.to, '::timestamptz')}`);
    for (const f of n.filters) where.push(filterSql(f, types[f.key], p));
    const agg = n.measure === 'count' ? 'count(*)' : `COALESCE(sum((e.attributes->>${p(n.measure.sum)})::numeric), 0)`;
    return `((SELECT ${agg} FROM marketing_events e WHERE ${where.join(' AND ')}) ${LEAF_CMP[n.op]} ${p(n.value, '::numeric')})`;
  };
  return node(rule);
}

function filterSql(f: EventFilter, type: string | undefined, p: (v: unknown, cast?: string) => string): string {
  if (!type) return 'FALSE';
  const text = `(e.attributes->>${p(f.key)})`;
  if (type === 'string') {
    if (f.op === 'contains') return `strpos(${text}, ${p(f.value)}) > 0`;
    if (f.op === 'in') return `${text} = ANY(${p(f.value, '::text[]')})`;
    return `${text} ${f.op === 'neq' ? '<>' : '='} ${p(f.value)}`;
  }
  if (type === 'number') return `${text}::numeric ${NUM_CMP[f.op] ?? '='} ${p(f.value, '::numeric')}`;
  if (type === 'boolean') return `${text}::boolean = ${p(f.value, '::boolean')}`;
  if (f.op === 'within_last_days') return `${text}::timestamptz BETWEEN now() - make_interval(days => ${p(f.value, '::int')}) AND now()`;
  if (f.op === 'within_next_days') return `${text}::timestamptz BETWEEN now() AND now() + make_interval(days => ${p(f.value, '::int')})`;
  return `${text}::timestamptz ${f.op === 'before' ? '<' : '>'} ${p(f.value, '::timestamptz')}`;
}

export function segmentIdsIn(rule: EventRule): string[] {
  if (isGroup(rule)) return [...new Set(rule.children.flatMap(segmentIdsIn))];
  return rule.kind === 'segment' ? [rule.segmentId] : [];
}

/** Every event name (and its attribute keys) a workflow / rule JSON refers to — for the catalog's archive check (spec §14). */
export function eventRefsIn(value: unknown, refs = new Map<string, Set<string>>()): Map<string, Set<string>> {
  if (Array.isArray(value)) { for (const v of value) eventRefsIn(v, refs); return refs; }
  if (!value || typeof value !== 'object') return refs;
  const o = value as Record<string, unknown>;
  const name = typeof o.eventName === 'string' ? o.eventName : o.kind === 'event' && typeof o.name === 'string' ? o.name : null;
  if (name) {
    const keys = refs.get(name) ?? new Set<string>();
    for (const f of Array.isArray(o.filters) ? o.filters : []) if (typeof (f as EventFilter)?.key === 'string') keys.add((f as EventFilter).key);
    const m = o.measure as { sum?: unknown } | undefined;
    if (m && typeof m === 'object' && typeof m.sum === 'string') keys.add(m.sum);
    refs.set(name, keys);
  }
  for (const v of Object.values(o)) eventRefsIn(v, refs);
  return refs;
}
```

- [ ] **Step 4: Run the tests** — same command. Expected: PASS. If the `params` order assertion fails, read the generated order and fix the implementation (not the test) only if the implementation pushes a value twice or skips one; the order in the test follows the code above (per leaf: name, window, filters, sum key, value; the segment's inlined leaf last).

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-events/domain/attribution* apps/commerce-platform/src/modules/integration/marketing-events/domain/event-rule*
git commit -m "feat(marketing-events): attribution and event rules (validate, compile to SQL)"
```

### Task 5: Ingest API

**Files:**
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/device-links.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/events.store.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/application/event-catalog.service.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/application/event-ingest.service.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/presentation/events.schemas.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/presentation/events-ingest.controller.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/marketing-events.module.ts`
- Modify: `apps/commerce-platform/src/app.module.ts`, `apps/commerce-platform/.env.example`
- Test: `apps/commerce-platform/src/modules/integration/marketing-events/application/event-ingest.service.spec.ts`

**Interfaces:**
- Consumes: `normalizeEvent`, `DEVICE_ID` (Task 2), `linkAt`, `attributeEvent`, `DeviceLink` (Task 4).
- Produces:
  - `linksOf(m: EntityManager, deviceId: string): Promise<DeviceLink[]>`, `usableUsers(m: EntityManager, ids: string[]): Promise<Set<string>>` (device-links.ts)
  - `EventsStore.ingest(device: IngestDevice, events: AcceptedEvent[], now: Date): Promise<Set<string>>` (inserted event ids), `EventsStore.list(q)`, `EventsStore.daily(from, to)`, `EventsStore.coverage()`, `EventsStore.coverageStart()`, `EventsStore.byIds(ids)`
  - `EventCatalogService.byName(): Promise<Map<string, EventDefinition>>` (60 s cache), `EventCatalogService.invalidate()`
  - `EventIngestService.ingest(raw: unknown, now?: Date): Promise<{ results: IngestResult[] }>`
  - local event `'marketing-trigger.events'` with payload `{ eventIds: string[] }`
  - `MarketingEventsModule` exporting `EventCatalogService`, `EventsStore` (Task 7 adds more)

- [ ] **Step 1: Write the failing test** `event-ingest.service.spec.ts`:

```ts
import { HttpException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import type { EventDefinition } from '@cp/marketing-workflow';
import { EventIngestService } from './event-ingest.service';

const def: EventDefinition = { name: 'add_to_cart', label: '', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'price', type: 'number', label: '' }] };
const now = new Date('2026-10-10T10:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (n: number, over: object = {}) => ({ eventId: id(n), name: 'add_to_cart', occurredAt: now.toISOString(), attributes: { price: 10 }, ...over });
const body = (events: object[], over: object = {}) => ({ schemaVersion: 1, deviceId: 'a'.repeat(32), platform: 'web', events, ...over });

function setup(already: string[] = []) {
  const stored = new Set(already);
  const store = { ingest: jest.fn(async (_d: unknown, events: { eventId: string }[]) => {
    const fresh = new Set<string>();
    for (const e of events) if (!stored.has(e.eventId)) { stored.add(e.eventId); fresh.add(e.eventId); }
    return fresh;
  }) };
  const catalog = { byName: jest.fn(async () => new Map([[def.name, def]])) };
  const emitter = { emit: jest.fn() };
  return { svc: new EventIngestService(store as never, catalog as never, emitter as never), store, emitter };
}

describe('EventIngestService', () => {
  beforeEach(() => { process.env.MARKETING_EVENTS_INGEST_ENABLED = 'true'; });
  afterAll(() => { delete process.env.MARKETING_EVENTS_INGEST_ENABLED; });

  it('answers per event in request order and signals only newly stored events', async () => {
    const s = setup([id(2)]);
    const r = await s.svc.ingest(body([ev(1), ev(2), ev(3, { name: 'nope' }), ev(4, { attributes: { price: 'x' } })]), now);
    expect(r.results).toEqual([
      { eventId: id(1), status: 'accepted' }, { eventId: id(2), status: 'duplicate' },
      { eventId: id(3), status: 'rejected', reason: 'unknown_event' }, { eventId: id(4), status: 'rejected', reason: 'bad_attribute_type' },
    ]);
    expect(s.emitter.emit).toHaveBeenCalledWith('marketing-trigger.events', { eventIds: [id(1)] });
  });

  it('posting the same batch twice stores it once and signals once', async () => {
    const s = setup();
    await s.svc.ingest(body([ev(1)]), now);
    const again = await s.svc.ingest(body([ev(1)]), now);
    expect(again.results).toEqual([{ eventId: id(1), status: 'duplicate' }]);
    expect(s.emitter.emit).toHaveBeenCalledTimes(1);
  });

  it('server sets source and environment; the client cannot', async () => {
    const s = setup();
    await expect(s.svc.ingest(body([ev(1)], { source: 'commerce_server' }), now)).rejects.toThrow();
    await s.svc.ingest(body([ev(1)], { platform: 'ios' }), now);
    expect(s.store.ingest.mock.calls[0][0]).toMatchObject({ source: 'mobile_app', platform: 'ios' });
  });

  it('is off unless enabled, refuses large bodies, bad device ids and too many events per device', async () => {
    const s = setup();
    delete process.env.MARKETING_EVENTS_INGEST_ENABLED;
    await expect(s.svc.ingest(body([ev(1)]), now)).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env.MARKETING_EVENTS_INGEST_ENABLED = 'true';
    await expect(s.svc.ingest(body([ev(1, { attributes: { price: 1, pad: 'x'.repeat(40_000) } })]), now)).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(s.svc.ingest(body([ev(1)], { deviceId: 'short' }), now)).rejects.toThrow();
    const batch = (start: number) => body(Array.from({ length: 20 }, (_, i) => ev(start + i)));
    await s.svc.ingest(batch(100), now); await s.svc.ingest(batch(200), now); await s.svc.ingest(batch(300), now);
    await expect(s.svc.ingest(batch(400), now)).rejects.toBeInstanceOf(HttpException);
    await expect(s.svc.ingest(batch(500), new Date(now.getTime() + 61_000))).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts event-ingest.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `infrastructure/device-links.ts` (Task 6 adds more functions to this file):

```ts
import type { EntityManager } from 'typeorm';
import type { DeviceLink } from '../domain/attribution';

/** A device's links, oldest first (spec §5). */
export async function linksOf(m: EntityManager, deviceId: string): Promise<DeviceLink[]> {
  const rows = await m.query(`SELECT user_id, linked_at, is_staff FROM marketing_device_links WHERE device_id = $1 ORDER BY linked_at`, [deviceId]);
  return rows.map((r: Record<string, unknown>) => ({ userId: r.user_id as string, linkedAt: new Date(r.linked_at as string), isStaff: !!r.is_staff }));
}

/** Customers whose events may be used: signup consent given, not PDPA-deleted (spec §5.1). */
export async function usableUsers(m: EntityManager, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await m.query(`SELECT id FROM josh_customers WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
    AND (data->>'pdpa_consent')::boolean IS TRUE`, [ids]);
  return new Set(rows.map((r: { id: string }) => r.id));
}
```

`infrastructure/events.store.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EventCoverage, EventDailyRow, MarketingEventRow } from '@cp/marketing-workflow';
import { attributeEvent, linkAt } from '../domain/attribution';
import { linksOf, usableUsers } from './device-links';

export interface IngestDevice { deviceId: string; platform: string; pushSubscriptionId: string | null; source: string; environment: string; schemaVersion: number }
export interface AcceptedEvent {
  eventId: string; name: string; occurredAt: Date; attributes: Record<string, unknown>;
  companyId: string | null; branchId: string | null; actorKind: string | null;
}
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const toRow = (r: Record<string, unknown>): MarketingEventRow => ({
  eventId: r.event_id as string, deviceId: r.device_id as string, platform: r.platform as string, source: r.source as string, name: r.name as string,
  attributes: (r.attributes as Record<string, unknown>) ?? {}, companyId: (r.company_id as string) ?? null, branchId: (r.branch_id as string) ?? null,
  actorKind: (r.actor_kind as string) ?? null, occurredAt: iso(r.occurred_at)!, receivedAt: iso(r.received_at)!,
  attributedUserId: (r.attributed_user_id as string) ?? null, attribution: (r.attribution as string) ?? null,
});

/** Every SQL over marketing_events / devices / coverage outside the device-link and retention paths. */
@Injectable()
export class EventsStore {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** One transaction: device row, coverage, events (dedupe on event id). Returns the event ids actually stored. */
  ingest(d: IngestDevice, events: AcceptedEvent[], now: Date): Promise<Set<string>> {
    return this.db.transaction(async (m) => {
      await m.query(`INSERT INTO marketing_devices (device_id, platform, push_subscription_id, first_seen_at, last_seen_at) VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (device_id) DO UPDATE SET platform = EXCLUDED.platform,
          push_subscription_id = COALESCE(EXCLUDED.push_subscription_id, marketing_devices.push_subscription_id), last_seen_at = EXCLUDED.last_seen_at
        WHERE marketing_devices.platform IS DISTINCT FROM EXCLUDED.platform
          OR (EXCLUDED.push_subscription_id IS NOT NULL AND marketing_devices.push_subscription_id IS DISTINCT FROM EXCLUDED.push_subscription_id)
          OR marketing_devices.last_seen_at < EXCLUDED.last_seen_at - interval '1 hour'`, [d.deviceId, d.platform, d.pushSubscriptionId, now]);
      await m.query(`INSERT INTO marketing_event_coverage (platform, collecting_since) VALUES ($1, $2) ON CONFLICT (platform) DO NOTHING`, [d.platform, now]);
      const links = await linksOf(m, d.deviceId);
      const usable = await usableUsers(m, [...new Set(links.filter((l) => !l.isStaff).map((l) => l.userId))]);
      const stored = new Set<string>();
      for (const e of events) {
        const a = attributeEvent(linkAt(links, e.occurredAt), (u) => usable.has(u), e.actorKind);
        const rows = await m.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name, attributes,
            company_id, branch_id, actor_kind, occurred_at, attributed_user_id, attribution)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (event_id, occurred_at) DO NOTHING RETURNING event_id`,
          [d.schemaVersion, e.eventId, d.deviceId, d.platform, d.source, d.environment, e.name, JSON.stringify(e.attributes),
            e.companyId, e.branchId, e.actorKind, e.occurredAt, a.userId, a.attribution]);
        if (rows.length) stored.add(e.eventId);
      }
      return stored;
    });
  }

  async byIds(ids: string[]): Promise<MarketingEventRow[]> {
    if (!ids.length) return [];
    // occurred_at bound keeps partition pruning to the last 8 days (ingest refuses older events).
    return (await this.db.query(`SELECT * FROM marketing_events WHERE event_id = ANY($1::uuid[]) AND occurred_at >= now() - interval '8 days'`, [ids])).map(toRow);
  }

  async list(q: { deviceId?: string; userId?: string; name?: string; page: number }): Promise<{ rows: MarketingEventRow[]; total: number }> {
    const rows = await this.db.query(`SELECT *, count(*) OVER ()::int AS total FROM marketing_events
      WHERE ($1::text IS NULL OR device_id = $1) AND ($2::uuid IS NULL OR attributed_user_id = $2) AND ($3::text IS NULL OR name = $3)
      ORDER BY occurred_at DESC LIMIT 50 OFFSET $4`, [q.deviceId ?? null, q.userId ?? null, q.name ?? null, (q.page - 1) * 50]);
    return { total: rows[0]?.total ?? 0, rows: rows.map(toRow) };
  }

  async daily(from: string, to: string): Promise<EventDailyRow[]> {
    return (await this.db.query(`SELECT to_char(date, 'YYYY-MM-DD') AS date, name, platform, events, users, devices FROM marketing_event_daily
      WHERE date BETWEEN $1::date AND $2::date ORDER BY date, name, platform`, [from, to])) as EventDailyRow[];
  }

  async coverage(): Promise<EventCoverage[]> {
    return (await this.db.query(`SELECT platform, collecting_since FROM marketing_event_coverage ORDER BY platform`))
      .map((r: { platform: string; collecting_since: Date }) => ({ platform: r.platform, collectingSince: new Date(r.collecting_since).toISOString() }));
  }

  /** Coverage start for rules (spec §11): the earliest platform. null = nothing collected yet. */
  async coverageStart(): Promise<Date | null> {
    const [r] = await this.db.query(`SELECT min(collecting_since) AS at FROM marketing_event_coverage`);
    return r?.at ? new Date(r.at) : null;
  }
}
```

`application/event-catalog.service.ts` (read side; Task 7 adds writes):

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EventDefinition } from '@cp/marketing-workflow';
import { MarketingEventDefinitionRow } from '../infrastructure/marketing-event-definition.entity';

const CACHE_MS = 60_000;
export const toDefinition = (r: MarketingEventDefinitionRow): EventDefinition => ({
  name: r.name, label: r.label, description: r.description ?? null, attributes: r.attributes ?? [], evidence: r.evidence, status: r.status,
  createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(),
});

/** The catalog, cached per process for ingest and rule checks; writes invalidate it (spec §3, §14). */
@Injectable()
export class EventCatalogService {
  private cache: { at: number; map: Map<string, EventDefinition> } | null = null;
  constructor(@InjectRepository(MarketingEventDefinitionRow) protected readonly rows: Repository<MarketingEventDefinitionRow>) {}

  async byName(now = Date.now()): Promise<Map<string, EventDefinition>> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.map;
    const map = new Map((await this.rows.find({ order: { name: 'ASC' } })).map((r) => [r.name, toDefinition(r)] as const));
    this.cache = { at: now, map };
    return map;
  }

  invalidate(): void { this.cache = null; }
}
```

`presentation/events.schemas.ts` (Task 7 and Task 9 add more schemas here):

```ts
import { z } from 'zod';
import { DEVICE_ID } from '../domain/event-catalog';

const opaque = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
/** Public ingest (spec §3). source / environment / receivedAt are not accepted from clients (strict). */
export const ingestSchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().regex(DEVICE_ID),
  platform: z.enum(['web', 'ios', 'android']),
  pushSubscriptionId: z.string().uuid().optional(),
  events: z.array(z.object({
    eventId: z.string().uuid(),
    name: z.string().min(1).max(64),
    occurredAt: z.string().datetime({ offset: true }),
    context: z.object({ companyId: opaque.optional(), branchId: opaque.optional(), actorKind: z.enum(['customer', 'staff', 'anonymous']).optional() }).strict().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  }).strict()).min(1).max(20),
}).strict();
export type IngestBody = z.infer<typeof ingestSchema>;
```

`application/event-ingest.service.ts`:

```ts
import { HttpException, HttpStatus, Injectable, Logger, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { parse } from '../../growth/growth.validation';
import { normalizeEvent, type Rejection } from '../domain/event-catalog';
import { EventsStore, type AcceptedEvent } from '../infrastructure/events.store';
import { ingestSchema } from '../presentation/events.schemas';
import { EventCatalogService } from './event-catalog.service';

export type IngestResult = { eventId: string; status: 'accepted' | 'duplicate' } | { eventId: string; status: 'rejected'; reason: Rejection };
const MAX_BODY_BYTES = 32 * 1024;
const DEVICE_EVENTS_PER_MINUTE = 60;
const enabled = () => process.env.MARKETING_EVENTS_INGEST_ENABLED === 'true';

/**
 * Fixed one-minute window per device. ponytail: per process — move to a Redis counter if commerce-platform runs more
 * than one instance.
 */
class DeviceLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  take(deviceId: string, n: number, now: number): boolean {
    if (this.windows.size > 10_000) for (const [k, w] of this.windows) if (now - w.start >= 60_000) this.windows.delete(k);
    const w = this.windows.get(deviceId);
    if (!w || now - w.start >= 60_000) { this.windows.set(deviceId, { start: now, count: n }); return n <= DEVICE_EVENTS_PER_MINUTE; }
    if (w.count + n > DEVICE_EVENTS_PER_MINUTE) return false;
    w.count += n;
    return true;
  }
}

/** POST /api/events (spec §3): validate, store once per event id, signal workflows after commit. No per-request logs. */
@Injectable()
export class EventIngestService {
  private readonly logger = new Logger(EventIngestService.name);
  private readonly limiter = new DeviceLimiter();
  private counts: Record<string, number> = {};
  private countsSince = Date.now();

  constructor(private readonly store: EventsStore, private readonly catalog: EventCatalogService, private readonly emitter: EventEmitter2) {}

  async ingest(raw: unknown, now = new Date()): Promise<{ results: IngestResult[] }> {
    if (!enabled()) throw new ServiceUnavailableException({ code: 'ingest_disabled' });
    if (Buffer.byteLength(JSON.stringify(raw ?? null), 'utf8') > MAX_BODY_BYTES) throw new PayloadTooLargeException('too_large');
    const body = parse(ingestSchema, raw);
    if (!this.limiter.take(body.deviceId, body.events.length, now.getTime())) throw new HttpException('Too many events', HttpStatus.TOO_MANY_REQUESTS);
    const catalog = await this.catalog.byName();
    const results = new Map<string, IngestResult>();
    const accepted: AcceptedEvent[] = [];
    for (const e of body.events) {
      const n = normalizeEvent(catalog.get(e.name), e, now);
      if (!n.ok) { results.set(e.eventId, { eventId: e.eventId, status: 'rejected', reason: n.reason }); continue; }
      accepted.push({ eventId: e.eventId, name: e.name, occurredAt: n.occurredAt, attributes: n.attributes,
        companyId: e.context?.companyId ?? null, branchId: e.context?.branchId ?? null, actorKind: e.context?.actorKind ?? null });
    }
    const stored = accepted.length ? await this.store.ingest({
      deviceId: body.deviceId, platform: body.platform, pushSubscriptionId: body.pushSubscriptionId ?? null, schemaVersion: body.schemaVersion,
      source: body.platform === 'web' ? 'shop_browser' : 'mobile_app', environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    }, accepted, now) : new Set<string>();
    for (const e of accepted) results.set(e.eventId, { eventId: e.eventId, status: stored.has(e.eventId) ? 'accepted' : 'duplicate' });
    const ordered = body.events.map((e) => results.get(e.eventId)!);
    this.count(ordered, now.getTime());
    if (stored.size) this.emitter.emit('marketing-trigger.events', { eventIds: [...stored] });
    return { results: ordered };
  }

  /** One log line per 5 minutes with totals (spec §3: no per-request logs). */
  private count(results: IngestResult[], now: number) {
    for (const r of results) { const k = r.status === 'rejected' ? `rejected:${r.reason}` : r.status; this.counts[k] = (this.counts[k] ?? 0) + 1; }
    if (now - this.countsSince < 5 * 60_000) return;
    this.logger.log(`events ingest ${JSON.stringify(this.counts)}`);
    this.counts = {}; this.countsSince = now;
  }
}
```

`presentation/events-ingest.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../../../../shared-kernel/presentation/auth.decorators';
import { Throttle } from '../../../../shared-kernel/presentation/throttle';
import { EventIngestService } from '../application/event-ingest.service';

/** shop-web and mobile post behaviour events here (spec §3). Unauthenticated: identity comes from device links. */
@Controller('events')
export class EventsIngestController {
  constructor(private readonly ingest: EventIngestService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  post(@Body() body: unknown) { return this.ingest.ingest(body); }
}
```

`marketing-events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventCatalogService } from './application/event-catalog.service';
import { EventIngestService } from './application/event-ingest.service';
import { MarketingDynamicSegmentRow } from './infrastructure/marketing-dynamic-segment.entity';
import { MarketingEventDefinitionRow } from './infrastructure/marketing-event-definition.entity';
import { EventsStore } from './infrastructure/events.store';
import { EventsIngestController } from './presentation/events-ingest.controller';

/** Customer behaviour events owned by commerce (spec 2026-10-10-marketing-event-layer). */
@Module({
  imports: [TypeOrmModule.forFeature([MarketingEventDefinitionRow, MarketingDynamicSegmentRow])],
  controllers: [EventsIngestController],
  providers: [EventsStore, EventCatalogService, EventIngestService],
  exports: [EventsStore, EventCatalogService],
})
export class MarketingEventsModule {}
```

In `app.module.ts` import `MarketingEventsModule` from `./modules/integration/marketing-events/marketing-events.module` and add it to `imports` right before `MarketingWorkflowModule`.

In `apps/commerce-platform/.env.example`, under `CRON_MARKETING_WORKFLOW_ENABLED=true` add:

```
# Public behaviour-event ingest POST /api/events (spec 2026-10-10-marketing-event-layer). Off unless "true".
MARKETING_EVENTS_INGEST_ENABLED=false
```

- [ ] **Step 4: Check the route is free and run the test**

Run: `grep -rn "Controller('events')" apps/commerce-platform/src` — expected: only the new controller.
Run: `npx jest -c apps/commerce-platform/jest.config.cts event-ingest.service` — expected: PASS.
Run: `npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json` — expected: only the errors recorded in Task 1.

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-events apps/commerce-platform/src/app.module.ts apps/commerce-platform/.env.example
git commit -m "feat(marketing-events): public ingest API with catalog checks, dedupe and per-device limit"
```

### Task 6: Device links, consent and PDPA through josh-events

**Files:**
- Modify: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/device-links.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/infrastructure/workflow.store.ts` (two exported functions)
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.ts`
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.controller.ts`
- Test: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.spec.ts`
- Test: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/device-links.db.spec.ts`

**Interfaces:**
- Consumes: `linksOf`, `usableUsers` (Task 5).
- Produces:
  - `linkDevice(m: EntityManager, l: { deviceId: string; userId: string; platform: string; linkedAt: Date }): Promise<{ recentEventIds: string[]; usable: boolean }>`
  - `withdrawConsent(m: EntityManager, userId: string): Promise<void>` (deletes the user's attributed events)
  - `deleteMarketingEventsForCustomer(m: EntityManager, userId: string): Promise<void>` (PDPA)
  - workflow.store.ts: `stopEnrollmentsForCustomer(m, userId, reason: string)`, `adoptGuestEnrollments(m, deviceId, userId)`
  - josh-events handles `device.snapshot` / `device.deleted`; backfill group `device`

- [ ] **Step 1: Write the failing unit tests** — append inside `describe('JoshEventsService', …)` in `josh-events.service.spec.ts` (reuse its `makeService` / `ref` helpers; the reference helper is the `ref()` function defined in the reference-copies `describe`, so put the device test in that block):

```ts
  it('customer.snapshot without consent removes the customer\'s events and stops journeys (spec §5.1)', async () => {
    const U = '22222222-2222-4222-8222-222222222222';
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'customer.snapshot', aggregateId: U, version: '5', occurredAt: '', data: { pdpa_consent: false } });
    const sqls = calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());
    expect(sqls).toContain('DELETE FROM marketing_events WHERE attributed_user_id = $1');
    expect(sqls.some((q) => q.startsWith("UPDATE marketing_workflow_enrollments SET status = 'skipped'"))).toBe(true);
    const consenting = makeService(null);
    await consenting.svc.apply({ type: 'customer.snapshot', aggregateId: U, version: '5', occurredAt: '', data: { pdpa_consent: true } });
    expect(consenting.calls.some(([sql]) => sql.includes('DELETE FROM marketing_events'))).toBe(false);
  });

  it('customer.deleted also removes events, device links, devices and the guest push log (PDPA)', async () => {
    const U = '22222222-2222-4222-8222-222222222222';
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'customer.deleted', aggregateId: U, version: '7', occurredAt: '', data: {} });
    const sqls = calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());
    expect(sqls).toContain('DELETE FROM marketing_events WHERE attributed_user_id = $1');
    expect(sqls.some((q) => q.startsWith('DELETE FROM marketing_device_links WHERE user_id = $1'))).toBe(true);
  });
```

Inside the reference-copies `describe` (where `ref()` and `CO` exist):

```ts
    it('device.snapshot copies the josh row and records a device link (spec §5)', async () => {
      const { svc, calls } = ref();
      const data = { id: CO, user_id: '22222222-2222-4222-8222-222222222222', individual_id: 'a'.repeat(32), platform: 'web',
        first_seen_at: '2026-10-10T00:00:00Z', last_seen_at: '2026-10-10T01:00:00Z' };
      expect(await svc.apply({ type: 'device.snapshot', aggregateId: CO, version: '30', occurredAt: 'x', data })).toBe('applied');
      expect(calls.find(([sql]) => sql.startsWith('INSERT INTO josh_user_devices'))).toBeDefined();
      const link = calls.find(([sql]) => sql.includes('INSERT INTO marketing_device_links'));
      expect(link?.[1]).toEqual(['a'.repeat(32), data.user_id, 'web', new Date('2026-10-10T01:00:00Z'), false]);
    });
```

`ref()`'s fake answers `[]` to every other query; `linkDevice` must cope with that (no links found → no backfill).

The reason becomes a bind parameter in `stopEnrollmentsForCustomer`, so update the existing PDPA test's lookup (`'customer.deleted stops the customer's marketing journeys …'`):

```ts
    const stop = calls.findIndex(([sql, p]) => sql.includes('UPDATE marketing_workflow_enrollments') && (p ?? []).includes('customer_deleted'));
```

- [ ] **Step 2: Write the DB spec** `marketing-events/infrastructure/device-links.db.spec.ts` (opt-in, like `workflow.store.db.spec.ts`):

```ts
import { DataSource } from 'typeorm';
import { deleteMarketingEventsForCustomer, linkDevice, withdrawConsent } from './device-links';

/** Opt-in: MARKETING_TEST_DATABASE_URL=postgres:///<migrated db> (never a shared / prod DB). */
const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('device links (real DB)', () => {
  let db: DataSource;
  const A = '0a000000-0000-4000-8000-00000000000a'; const B = '0b000000-0000-4000-8000-00000000000b';
  const D = 'd'.repeat(32);
  const at = (h: number) => new Date(Date.now() - (10 - h) * 3600_000);
  const event = (n: number, h: number) => db.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name, occurred_at)
    VALUES (1, $1, $2, 'web', 'shop_browser', 'development', 'view_item', $3)`, [`e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, D, at(h)]);
  const owners = async () => (await db.query(`SELECT event_id, attributed_user_id AS u, attribution AS a, name FROM marketing_events WHERE device_id = $1 ORDER BY occurred_at`, [D]))
    .map((r: { u: string | null; a: string | null }) => [r.u, r.a]);

  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url }).initialize();
    for (const u of [A, B]) await db.query(`INSERT INTO josh_customers (id, data, source_version) VALUES ($1, '{"pdpa_consent": true}', 1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [u]);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM marketing_events WHERE device_id = $1`, [D]);
    await db.query(`DELETE FROM marketing_device_links WHERE device_id = $1`, [D]);
    await db.query(`DELETE FROM josh_customers WHERE id = ANY($1::uuid[])`, [[A, B]]);
    await db.destroy();
  });

  it('guest → A → B; a late, out-of-order link reattributes only its range; facts never change', async () => {
    await event(1, 1); await event(2, 3); await event(3, 6); await event(4, 8);
    const facts = await db.query(`SELECT event_id, name, occurred_at, device_id FROM marketing_events WHERE device_id = $1 ORDER BY occurred_at`, [D]);
    await db.transaction((m) => linkDevice(m, { deviceId: D, userId: B, platform: 'web', linkedAt: at(7) }));
    expect(await owners()).toEqual([[B, 'device_link'], [B, 'device_link'], [B, 'device_link'], [B, 'device_link']]);
    await db.transaction((m) => linkDevice(m, { deviceId: D, userId: A, platform: 'web', linkedAt: at(2) })); // arrives late
    expect(await owners()).toEqual([[A, 'device_link'], [A, 'device_link'], [A, 'device_link'], [B, 'device_link']]);
    expect(await db.query(`SELECT event_id, name, occurred_at, device_id FROM marketing_events WHERE device_id = $1 ORDER BY occurred_at`, [D])).toEqual(facts);
  });

  it('withdrawn consent deletes the user\'s events; PDPA delete removes links too', async () => {
    await db.transaction((m) => withdrawConsent(m, A));
    expect((await owners()).filter(([u]) => u === A)).toEqual([]);
    await db.transaction((m) => deleteMarketingEventsForCustomer(m, B));
    expect(await db.query(`SELECT 1 FROM marketing_device_links WHERE user_id = $1`, [B])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the unit tests to see them fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts josh-events.service`
Expected: FAIL — `unsupported josh event device.snapshot` and the consent / PDPA assertions.

- [ ] **Step 4: Implement** — append to `device-links.ts`:

```ts
import type { EntityManager } from 'typeorm';   // already imported at the top

const RECENT_MS = 60 * 60_000; // = TRIGGER_RECENT_MINUTES

/**
 * A josh device link (spec §5). Inserts the link, then re-attributes only the device's events in the range this link
 * covers ([its time, next link) — from -∞ when it is the first link). Fact columns are never written. Returns the
 * re-attributed events of the last hour (to re-check triggers) and whether the user is usable.
 */
export async function linkDevice(m: EntityManager, l: { deviceId: string; userId: string; platform: string; linkedAt: Date }): Promise<{ recentEventIds: string[]; usable: boolean }> {
  const [prev] = await m.query(`SELECT user_id FROM marketing_device_links WHERE device_id = $1 AND linked_at <= $2 ORDER BY linked_at DESC LIMIT 1`, [l.deviceId, l.linkedAt]);
  if (prev?.user_id === l.userId) return { recentEventIds: [], usable: false };
  const [staff] = await m.query(`SELECT EXISTS (SELECT 1 FROM josh_staff WHERE id = $1 AND user_type IS DISTINCT FROM 'customer') AS hit`, [l.userId]);
  const isStaff = !!staff?.hit;
  await m.query(`INSERT INTO marketing_device_links (device_id, user_id, platform, linked_at, is_staff) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (device_id, linked_at) DO NOTHING`, [l.deviceId, l.userId, l.platform, l.linkedAt, isStaff]);
  const links = await linksOf(m, l.deviceId);
  const i = links.findIndex((x) => x.linkedAt.getTime() === l.linkedAt.getTime() && x.userId === l.userId);
  if (i < 0) return { recentEventIds: [], usable: false };
  const usable = !isStaff && (await usableUsers(m, [l.userId])).has(l.userId);
  const [userId, attribution] = isStaff ? [null, 'staff'] : usable ? [l.userId, 'device_link'] : [null, 'no_consent'];
  // TypeORM (postgres) resolves UPDATE … RETURNING to [rows, affectedCount].
  const [rows] = (await m.query(`UPDATE marketing_events SET attributed_user_id = $2, attribution = $3
    WHERE device_id = $1 AND ($4::timestamptz IS NULL OR occurred_at >= $4) AND ($5::timestamptz IS NULL OR occurred_at < $5)
    RETURNING event_id, occurred_at`, [l.deviceId, userId, attribution, i === 0 ? null : links[i].linkedAt, links[i + 1]?.linkedAt ?? null])) as [{ event_id: string; occurred_at: Date }[], number];
  const since = Date.now() - RECENT_MS;
  return { usable, recentEventIds: userId ? rows.filter((r) => new Date(r.occurred_at).getTime() >= since).map((r) => r.event_id) : [] };
}

/** Consent withdrawn (spec §5.1): the customer's attributed events go; later events from their devices stay unattributed. */
export async function withdrawConsent(m: EntityManager, userId: string): Promise<void> {
  await m.query(`DELETE FROM marketing_events WHERE attributed_user_id = $1`, [userId]);
}

/** PDPA delete (spec §17): events, links, devices the customer used and their guest push log. */
export async function deleteMarketingEventsForCustomer(m: EntityManager, userId: string): Promise<void> {
  await m.query(`DELETE FROM marketing_events WHERE attributed_user_id = $1`, [userId]);
  await m.query(`DELETE FROM marketing_guest_push_log WHERE device_id IN (SELECT device_id FROM marketing_device_links WHERE user_id = $1)`, [userId]);
  await m.query(`DELETE FROM marketing_devices WHERE device_id IN (SELECT device_id FROM marketing_device_links WHERE user_id = $1)`, [userId]);
  await m.query(`DELETE FROM marketing_device_links WHERE user_id = $1`, [userId]);
}
```

In `marketing-workflow/infrastructure/workflow.store.ts` add below `stopMarketingForCustomer` and make it use the first function:

```ts
/** Ends the customer's open journeys (PDPA delete, consent withdrawn). */
export async function stopEnrollmentsForCustomer(m: EntityManager, userId: string, reason: string): Promise<void> {
  await m.query(`UPDATE marketing_workflow_enrollments SET status = 'skipped', end_reason = $2, completed_at = now(),
    current_step_id = NULL, resume_at = NULL, waiting_for = NULL WHERE user_id = $1 AND status IN ('pending', 'running')`, [userId, reason]);
}

/**
 * A guest logged in (spec §5 step 4, §10): their open guest journeys become the customer's. One the customer already
 * has for the same workflow + occurrence ends as `merged` instead.
 */
export async function adoptGuestEnrollments(m: EntityManager, deviceId: string, userId: string): Promise<void> {
  await m.query(`UPDATE marketing_workflow_enrollments g SET user_id = $2 WHERE g.device_id = $1 AND g.user_id IS NULL AND g.status IN ('pending', 'running')
    AND NOT EXISTS (SELECT 1 FROM marketing_workflow_enrollments x WHERE x.workflow_id = g.workflow_id AND x.user_id = $2 AND x.occurrence_key = g.occurrence_key)`,
    [deviceId, userId]);
  await m.query(`UPDATE marketing_workflow_enrollments SET status = 'skipped', end_reason = 'merged', completed_at = now(), current_step_id = NULL,
    resume_at = NULL, waiting_for = NULL WHERE device_id = $1 AND user_id IS NULL AND status IN ('pending', 'running')`, [deviceId]);
}
```

and change the first statement of `stopMarketingForCustomer` to `await stopEnrollmentsForCustomer(m, userId, 'customer_deleted');`.

In `josh-events.service.ts`:
1. `REFERENCE_TABLES` gains `device: 'josh_user_devices'` (so `device.deleted` is the generic delete + tombstone).
2. Imports: `import { deleteMarketingEventsForCustomer, linkDevice, withdrawConsent } from '../../../marketing-events/infrastructure/device-links';` and `adoptGuestEnrollments, stopEnrollmentsForCustomer` from the workflow store.
3. `customer.snapshot` write callback becomes:

```ts
      case 'customer.snapshot':
        return this.signalled('marketing-trigger.customer', e.aggregateId, await this.guarded('josh_customers', 'id', e, async (m) => {
          await m.getRepository(JoshCustomerCopy).save({ id: e.aggregateId, data: e.data ?? {}, sourceVersion: e.version, deletedAt: null });
          // Signup consent (pdpa_consent) gates every use of events (spec §5.1); false → their events go, journeys stop.
          if (e.data?.pdpa_consent === false) {
            await withdrawConsent(m, e.aggregateId);
            await stopEnrollmentsForCustomer(m, e.aggregateId, 'consent_withdrawn');
          }
        }));
```

4. `customer.deleted` callback: after `stopMarketingForCustomer(m, e.aggregateId);` add `await deleteMarketingEventsForCustomer(m, e.aggregateId);`.
5. New case before `default`:

```ts
      case 'device.snapshot':
        return this.deviceLinked(e);
```

and the method:

```ts
  /** josh user_devices row → copy + device link, guest journeys adopted, recent events re-checked after commit (spec §5). */
  private async deviceLinked(e: JoshEnvelope): Promise<ApplyResult> {
    let recent: string[] = [];
    const result = await this.reference('josh_user_devices', e, async (m) => {
      await this.saveReference(m, 'josh_user_devices', e);
      const d = e.data;
      if (typeof d.user_id !== 'string' || typeof d.individual_id !== 'string') return;
      const linked = await linkDevice(m, { deviceId: d.individual_id, userId: d.user_id, platform: String(d.platform ?? 'web'),
        linkedAt: new Date(d.last_seen_at ?? e.occurredAt) });
      if (linked.usable) await adoptGuestEnrollments(m, d.individual_id, d.user_id);
      recent = linked.recentEventIds;
    });
    if (result === 'applied' && recent.length) this.emitter?.emit('marketing-trigger.events', { eventIds: recent });
    return result;
  }
```

In `josh-events.controller.ts` add `'device'` to `BACKFILL_GROUPS`.

- [ ] **Step 5: Run the tests**

Run: `npx jest -c apps/commerce-platform/jest.config.cts josh-events.service workflow.store`
Expected: PASS (old tests unchanged).
Run (if a migrated local DB exists): `MARKETING_TEST_DATABASE_URL=postgres:///commerce_stage2_test npx jest -c apps/commerce-platform/jest.config.cts device-links.db` — expect PASS; otherwise report it as skipped.

- [ ] **Step 6: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/device-links* \
  apps/commerce-platform/src/modules/integration/marketing-workflow/infrastructure/workflow.store.ts \
  apps/commerce-platform/src/modules/integration/connector/josh/events
git commit -m "feat(marketing-events): device links from josh, consent withdrawal and PDPA cleanup"
```

### Task 7: Catalog, event list and dynamic segments (admin API, rule evaluation)

**Files:**
- Modify: `apps/commerce-platform/src/modules/integration/marketing-events/application/event-catalog.service.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/application/event-rule.service.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/application/dynamic-segments.service.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-events/presentation/events.schemas.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/presentation/marketing-events.controller.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/presentation/dynamic-segments.controller.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-events/marketing-events.module.ts`
- Test: `apps/commerce-platform/src/modules/integration/marketing-events/application/event-catalog.service.spec.ts`, `.../application/dynamic-segments.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `EventCatalogService.list()`, `.create(input)`, `.update(name, input)`, `.archive(name)` (409 when an active workflow or a dynamic segment uses it)
  - `EventRuleService.context(now?): Promise<RuleContext>`, `.matches(rule, userId, m?): Promise<boolean>`, `.segmentMatches(segmentId, userId, m?): Promise<boolean>`, `.typesOf(eventName): Promise<Types>`, `.count(rule): Promise<number>`
  - `DynamicSegmentsService.list() / get(id) / create(input, actor) / update(id, input) / remove(id) / preview(rule)`
  - zod: `eventFilterSchema`, `eventRuleSchema`, `definitionSchema`, `dynamicSegmentSchema`, `eventListSchema`, `dailySchema`
  - Routes: `GET/POST /api/marketing/events/definitions`, `PUT /api/marketing/events/definitions/:name`, `POST /api/marketing/events/definitions/:name/archive`, `GET /api/marketing/events`, `GET /api/marketing/events/daily`, `GET/POST /api/marketing/dynamic-segments`, `GET/PUT/DELETE /api/marketing/dynamic-segments/:id`, `POST /api/marketing/dynamic-segments/preview`
  - Module exports gain `EventRuleService`, `DynamicSegmentsService`

- [ ] **Step 1: Write the failing tests**

`event-catalog.service.spec.ts`:

```ts
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { EventCatalogService } from './event-catalog.service';

const row = { name: 'add_to_cart', label: 'ใส่ตะกร้า', description: null, evidence: 'browser', status: 'active',
  attributes: [{ key: 'price', type: 'number', label: '' }, { key: 'item_id', type: 'string', label: '' }], createdAt: new Date(), updatedAt: new Date() };

function setup(activeSteps: unknown[] = [], segmentRules: unknown[] = []) {
  const rows = { find: jest.fn(async () => [row]), findOneBy: jest.fn(async () => ({ ...row })), save: jest.fn(async (r: object) => ({ ...row, ...r })) };
  const db = { query: jest.fn(async (sql: string) => {
    if (sql.includes('FROM marketing_workflows')) return activeSteps.map((steps, i) => ({ id: `w${i}`, name: `W${i}`, trigger_config: {}, exit_on_goal: null, steps }));
    if (sql.includes('FROM marketing_dynamic_segments')) return segmentRules.map((rule, i) => ({ id: `s${i}`, name: `S${i}`, rule }));
    return [];
  }) };
  return new EventCatalogService(rows as never, db as never);
}

describe('EventCatalogService', () => {
  it('refuses to archive an event an active workflow waits for', async () => {
    const svc = setup([[{ type: 'wait_event', eventName: 'add_to_cart', filters: [] }]]);
    await expect(svc.archive('add_to_cart')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to archive an attribute a dynamic segment sums', async () => {
    const svc = setup([], [{ kind: 'event', name: 'add_to_cart', measure: { sum: 'price' }, op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] }]);
    const next = { ...row, attributes: [{ ...row.attributes[0], archived: true }, row.attributes[1]] };
    await expect(svc.update('add_to_cart', next as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects PII attributes and type changes', async () => {
    const svc = setup();
    await expect(svc.update('add_to_cart', { ...row, attributes: [...row.attributes, { key: 'email', type: 'string', label: '' }] } as never))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(svc.update('add_to_cart', { ...row, attributes: [{ key: 'price', type: 'string', label: '' }, row.attributes[1]] } as never))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
```

`dynamic-segments.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { DynamicSegmentsService } from './dynamic-segments.service';

const S = '5e000000-0000-4000-8000-000000000001';
const rule = { kind: 'event', name: 'add_to_cart', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] };

function setup(activeAudience: unknown[] = []) {
  const rows = { find: jest.fn(async () => []), findOneBy: jest.fn(async () => ({ id: S, name: 'Cart', description: null, rule, createdBy: null, createdAt: new Date(), updatedAt: new Date() })),
    save: jest.fn(async (r: object) => ({ id: S, createdAt: new Date(), updatedAt: new Date(), ...r })), delete: jest.fn() };
  const db = { query: jest.fn(async () => activeAudience.map((steps, i) => ({ id: `w${i}`, name: `W${i}`, steps }))) };
  const rules = { context: jest.fn(async () => ({ catalog: new Map(), coverageStart: null, segmentIds: null, now: new Date() })), count: jest.fn(async () => 3) };
  return { svc: new DynamicSegmentsService(rows as never, db as never, rules as never), rows };
}

describe('DynamicSegmentsService', () => {
  it('saves a draft rule with its issues (catalog empty → reported, not thrown)', async () => {
    const { svc } = setup();
    const saved = await svc.create({ name: 'Cart', description: null, rule: rule as never }, 'm@x');
    expect(saved.issues).toEqual(['ไม่มี event "add_to_cart" ใน catalog']);
  });

  it('cannot be deleted while an active workflow uses it', async () => {
    const { svc, rows } = setup([[{ type: 'audience', dynamicSegmentIds: [S] }]]);
    await expect(svc.remove(S)).rejects.toBeInstanceOf(ConflictException);
    expect(rows.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts event-catalog.service dynamic-segments.service`
Expected: FAIL.

- [ ] **Step 3: Implement**

Extend `event-catalog.service.ts` (constructor gains the DataSource):

```ts
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EventDefinition, EventDefinitionInput } from '@cp/marketing-workflow';
import { definitionIssues } from '../domain/event-catalog';
import { eventRefsIn } from '../domain/event-rule';
import { MarketingEventDefinitionRow } from '../infrastructure/marketing-event-definition.entity';

// (CACHE_MS and toDefinition unchanged)

@Injectable()
export class EventCatalogService {
  private cache: { at: number; map: Map<string, EventDefinition> } | null = null;
  constructor(
    @InjectRepository(MarketingEventDefinitionRow) protected readonly rows: Repository<MarketingEventDefinitionRow>,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  // byName / invalidate unchanged

  async list(): Promise<EventDefinition[]> { return [...(await this.byName(0)).values()]; }

  async create(input: EventDefinitionInput): Promise<EventDefinition> {
    const issues = definitionIssues(input);
    if (issues.length) throw new UnprocessableEntityException({ message: 'บันทึก event ไม่ได้', issues });
    if (await this.rows.findOneBy({ name: input.name })) throw new ConflictException('มี event ชื่อนี้แล้ว');
    const saved = await this.rows.save({ ...input, status: 'active' as const });
    this.invalidate();
    return toDefinition(saved as MarketingEventDefinitionRow);
  }

  /** Name and attribute types are fixed; attributes are added or archived, never removed (spec §14). */
  async update(name: string, input: EventDefinitionInput): Promise<EventDefinition> {
    const row = await this.rows.findOneBy({ name });
    if (!row) throw new NotFoundException('ไม่พบ event');
    const issues = definitionIssues(input, toDefinition(row));
    if (issues.length) throw new UnprocessableEntityException({ message: 'บันทึก event ไม่ได้', issues });
    const newlyArchived = input.attributes.filter((a) => a.archived && !row.attributes.find((o) => o.key === a.key)?.archived).map((a) => a.key);
    if (newlyArchived.length) await this.assertUnused(name, newlyArchived);
    const saved = await this.rows.save({ ...row, label: input.label, description: input.description, evidence: input.evidence, attributes: input.attributes });
    this.invalidate();
    return toDefinition(saved as MarketingEventDefinitionRow);
  }

  async archive(name: string): Promise<EventDefinition> {
    const row = await this.rows.findOneBy({ name });
    if (!row) throw new NotFoundException('ไม่พบ event');
    await this.assertUnused(name, null);
    const saved = await this.rows.save({ ...row, status: 'archived' as const });
    this.invalidate();
    return toDefinition(saved as MarketingEventDefinitionRow);
  }

  /** keys null = the whole event. Active workflows (trigger, wait, goal, rules) and every dynamic segment count as users. */
  private async assertUnused(name: string, keys: string[] | null): Promise<void> {
    const users: string[] = [];
    const uses = (json: unknown) => { const k = eventRefsIn(json).get(name); return !!k && (keys === null || keys.some((x) => k.has(x))); };
    for (const w of await this.db.query(`SELECT id, name, trigger_config, exit_on_goal, steps FROM marketing_workflows WHERE status = 'active'`)) {
      if (uses([w.trigger_config, w.exit_on_goal, w.steps])) users.push(`workflow: ${w.name}`);
    }
    for (const s of await this.db.query(`SELECT id, name, rule FROM marketing_dynamic_segments`)) if (uses(s.rule)) users.push(`dynamic segment: ${s.name}`);
    if (users.length) throw new ConflictException({ message: 'ยังมีที่ใช้อยู่', users });
  }
}
```

`event-rule.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { EventRule } from '@cp/marketing-workflow';
import type { Types } from '../domain/event-filter';
import { compileRule, segmentIdsIn, typesOf, type RuleContext } from '../domain/event-rule';
import { usableUsers } from '../infrastructure/device-links';
import { EventsStore } from '../infrastructure/events.store';
import { MarketingDynamicSegmentRow } from '../infrastructure/marketing-dynamic-segment.entity';
import { EventCatalogService } from './event-catalog.service';

/** Live evaluation of event rules for one customer or a count over all customers (spec §11). Consent first (§5.1). */
@Injectable()
export class EventRuleService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(MarketingDynamicSegmentRow) private readonly segments: Repository<MarketingDynamicSegmentRow>,
    private readonly catalog: EventCatalogService,
    private readonly store: EventsStore,
  ) {}

  async context(now = new Date()): Promise<RuleContext> {
    const [catalog, coverageStart, ids] = await Promise.all([this.catalog.byName(), this.store.coverageStart(), this.segments.find({ select: { id: true } })]);
    return { catalog, coverageStart, segmentIds: new Set(ids.map((s) => s.id)), now };
  }

  async typesOf(eventName: string): Promise<Types> {
    const def = (await this.catalog.byName()).get(eventName);
    return def ? typesOf(def) : {};
  }

  async matches(rule: EventRule, userId: string, m: EntityManager = this.db.manager): Promise<boolean> {
    if (!(await usableUsers(m, [userId])).has(userId)) return false;
    const params: unknown[] = [userId];
    const sql = compileRule(rule, await this.refs(rule), '$1::uuid', params);
    const [r] = await m.query(`SELECT (${sql}) AS ok`, params);
    return !!r?.ok;
  }

  async segmentMatches(segmentId: string, userId: string, m: EntityManager = this.db.manager): Promise<boolean> {
    const s = await m.getRepository(MarketingDynamicSegmentRow).findOneBy({ id: segmentId });
    return s ? this.matches(s.rule, userId, m) : false;
  }

  /** Customers (with consent) matching now. 5 s statement timeout: preview must never load the database. */
  async count(rule: EventRule): Promise<number> {
    const params: unknown[] = [];
    const sql = compileRule(rule, await this.refs(rule), 'u.id', params);
    return this.db.transaction(async (m) => {
      await m.query(`SET LOCAL statement_timeout = '5s'`);
      const [r] = await m.query(`SELECT count(*)::int AS n FROM segment_customers u JOIN josh_customers c ON c.id = u.id
        WHERE (c.data->>'pdpa_consent')::boolean IS TRUE AND ${sql}`, params);
      return r?.n ?? 0;
    });
  }

  private async refs(rule: EventRule) {
    const ids = segmentIdsIn(rule);
    const rows = ids.length ? await this.segments.findBy({ id: In(ids) }) : [];
    return { catalog: await this.catalog.byName(), segments: new Map(rows.map((r) => [r.id, r.rule] as const)) };
  }
}
```

`dynamic-segments.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { DynamicSegment, DynamicSegmentInput, EventRule } from '@cp/marketing-workflow';
import { ruleIssues } from '../domain/event-rule';
import { MarketingDynamicSegmentRow } from '../infrastructure/marketing-dynamic-segment.entity';
import { EventRuleService } from './event-rule.service';

const iso = (d: Date) => new Date(d).toISOString();

/** Named event rules for commerce workflows only (spec §11): never frozen, never sent to josh. */
@Injectable()
export class DynamicSegmentsService {
  constructor(
    @InjectRepository(MarketingDynamicSegmentRow) private readonly rows: Repository<MarketingDynamicSegmentRow>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly rules: EventRuleService,
  ) {}

  async list(): Promise<DynamicSegment[]> { return Promise.all((await this.rows.find({ order: { name: 'ASC' } })).map((r) => this.toDto(r))); }
  async get(id: string): Promise<DynamicSegment> { return this.toDto(await this.row(id)); }

  async create(input: DynamicSegmentInput, actor: string): Promise<DynamicSegment> {
    return this.toDto(await this.rows.save({ ...input, createdBy: actor }) as MarketingDynamicSegmentRow);
  }

  async update(id: string, input: DynamicSegmentInput): Promise<DynamicSegment> {
    const row = await this.row(id);
    return this.toDto(await this.rows.save({ ...row, ...input }) as MarketingDynamicSegmentRow);
  }

  async remove(id: string): Promise<void> {
    await this.row(id);
    const users = (await this.db.query(`SELECT id, name, steps FROM marketing_workflows WHERE status = 'active'`))
      .filter((w: { steps: unknown }) => JSON.stringify(w.steps).includes(id)).map((w: { name: string }) => w.name);
    if (users.length) throw new ConflictException({ message: 'workflow ที่เปิดใช้อยู่ยังใช้ segment นี้', users });
    await this.rows.delete({ id });
  }

  async preview(rule: EventRule): Promise<{ count: number | null; issues: string[] }> {
    const issues = ruleIssues(rule, { ...(await this.rules.context()), segmentIds: null });
    return issues.length ? { count: null, issues } : { count: await this.rules.count(rule), issues };
  }

  private async row(id: string): Promise<MarketingDynamicSegmentRow> {
    const r = await this.rows.findOneBy({ id });
    if (!r) throw new NotFoundException('ไม่พบ dynamic segment');
    return r;
  }

  /** Drafts may be saved with issues; workflows refuse to activate on a segment that still has them (Task 9). */
  private async toDto(r: MarketingDynamicSegmentRow): Promise<DynamicSegment> {
    const issues = ruleIssues(r.rule, { ...(await this.rules.context()), segmentIds: null });
    return { id: r.id, name: r.name, description: r.description ?? null, rule: r.rule, createdBy: r.createdBy ?? null,
      createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), issues };
  }
}
```

Append to `events.schemas.ts`:

```ts
import type { EventRule } from '@cp/marketing-workflow';

const key = z.string().min(1).max(40);
export const eventFilterSchema = z.object({
  key, op: z.enum(['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'before', 'after', 'within_last_days', 'within_next_days']),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(500)).max(50), z.object({ fromTrigger: key }).strict()]),
}).strict();
const leafSchema = z.union([
  z.object({ kind: z.literal('event'), name: z.string().max(64), measure: z.union([z.literal('count'), z.object({ sum: key }).strict()]),
    op: z.enum(['gte', 'eq', 'lte']), value: z.number(),
    window: z.union([z.object({ lastDays: z.number().int() }).strict(), z.object({ from: z.string().max(40), to: z.string().max(40) }).strict()]),
    filters: z.array(eventFilterSchema).max(10) }).strict(),
  z.object({ kind: z.literal('segment'), segmentId: z.string().uuid() }).strict(),
]);
export const eventRuleSchema: z.ZodType<EventRule> = z.lazy(() => z.union([
  z.object({ op: z.enum(['AND', 'OR']), children: z.array(eventRuleSchema).max(16) }).strict(), leafSchema,
])) as z.ZodType<EventRule>;
export const definitionSchema = z.object({
  name: z.string().max(64), label: z.string().max(120), description: z.string().max(2000).nullable(), evidence: z.enum(['browser', 'server']),
  attributes: z.array(z.object({ key, type: z.enum(['string', 'number', 'boolean', 'date']), label: z.string().max(120), archived: z.boolean().optional() }).strict()).max(20),
}).strict();
export const dynamicSegmentSchema = z.object({ name: z.string().min(1).max(155), description: z.string().max(2000).nullable(), rule: eventRuleSchema }).strict();
export const previewSchema = z.object({ rule: eventRuleSchema }).strict();
export const eventListSchema = z.object({
  deviceId: z.string().regex(DEVICE_ID).optional(), userId: z.string().uuid().optional(), name: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const dailySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
```

`presentation/marketing-events.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { EventDefinitionInput } from '@cp/marketing-workflow';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { parse } from '../../growth/growth.validation';
import { EventCatalogService } from '../application/event-catalog.service';
import { EventsStore } from '../infrastructure/events.store';
import { dailySchema, definitionSchema, eventListSchema } from './events.schemas';

/** Event catalog + recent events + daily totals (spec §14). Static routes first. */
@Controller('marketing/events')
@StaffRoles('marketing')
export class MarketingEventsController {
  constructor(private readonly catalog: EventCatalogService, private readonly store: EventsStore) {}

  @Get('definitions') async definitions() { return { definitions: await this.catalog.list(), coverage: await this.store.coverage() }; }
  @Post('definitions') create(@Body() b: unknown) { return this.catalog.create(parse(definitionSchema, b) as EventDefinitionInput); }
  @Put('definitions/:name') update(@Param('name') name: string, @Body() b: unknown) { return this.catalog.update(name, parse(definitionSchema, b) as EventDefinitionInput); }
  @Post('definitions/:name/archive') archive(@Param('name') name: string) { return this.catalog.archive(name); }
  @Get('daily') daily(@Query() q: unknown) { const x = parse(dailySchema, q); return this.store.daily(x.from, x.to); }
  @Get() list(@Query() q: unknown) { return this.store.list(parse(eventListSchema, q)); }
}
```

`presentation/dynamic-segments.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { DynamicSegmentInput, EventRule } from '@cp/marketing-workflow';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { parse } from '../../growth/growth.validation';
import { DynamicSegmentsService } from '../application/dynamic-segments.service';
import { dynamicSegmentSchema, previewSchema } from './events.schemas';

@Controller('marketing/dynamic-segments')
@StaffRoles('marketing')
export class DynamicSegmentsController {
  constructor(private readonly segments: DynamicSegmentsService) {}

  @Get() list() { return this.segments.list(); }
  @Post('preview') preview(@Body() b: unknown) { return this.segments.preview(parse(previewSchema, b).rule as EventRule); }
  @Post() create(@Body() b: unknown, @Req() r: StaffRequest) { return this.segments.create(parse(dynamicSegmentSchema, b) as DynamicSegmentInput, r.staff.email); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.segments.get(id); }
  @Put(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.segments.update(id, parse(dynamicSegmentSchema, b) as DynamicSegmentInput); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.segments.remove(id); }
}
```

Module: add `MarketingEventsController`, `DynamicSegmentsController` to `controllers`; `EventRuleService`, `DynamicSegmentsService` to `providers` and `exports`.

- [ ] **Step 4: Run the tests**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-events`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-events
git commit -m "feat(marketing-events): catalog admin, event list, dynamic segments and live rule evaluation"
```

### Task 8: Partitions, retention job, system health

**Files:**
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/event-partitions.ts`
- Create: `apps/commerce-platform/src/modules/integration/marketing-events/application/event-retention.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-events/marketing-events.module.ts`
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/system-health.ts`
- Test: `apps/commerce-platform/src/modules/integration/marketing-events/infrastructure/event-partitions.spec.ts`, `.../infrastructure/event-partitions.db.spec.ts`

**Interfaces:**
- Produces: `monthStart(d: Date, add?: number): Date`, `partitionName(start: Date): string`, `expiredPartitions(names: string[], now: Date, keepDays?: number): string[]`, `ensurePartition(db: DataSource, start: Date): Promise<boolean>`, `dropExpiredPartitions(db: DataSource, now: Date): Promise<string[]>`, `eventStoreHealth(db: DataSource): Promise<{ rows: number; totalBytes: number; oldestAt: string | null; defaultPartitionRows: number }>`, `EventRetention.run(now?: Date)`.

- [ ] **Step 1: Write the failing unit test** `event-partitions.spec.ts`:

```ts
import { expiredPartitions, monthStart, partitionName } from './event-partitions';

describe('event partitions', () => {
  it('names months in UTC and steps across years', () => {
    expect(partitionName(monthStart(new Date('2026-12-31T20:00:00Z'), 1))).toBe('marketing_events_2027_01');
  });

  it('drops a month only when all of it is older than 90 days', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(expiredPartitions(['marketing_events_2026_06', 'marketing_events_2026_07', 'marketing_events_2026_10', 'marketing_events_default', 'other'], now))
      .toEqual(['marketing_events_2026_06']);
  });
});
```

`event-partitions.db.spec.ts` (opt-in):

```ts
import { DataSource } from 'typeorm';
import { ensurePartition, monthStart, partitionName } from './event-partitions';

const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('event partitions (real DB)', () => {
  let db: DataSource;
  beforeAll(async () => { db = await new DataSource({ type: 'postgres', url }).initialize(); });
  afterAll(() => db.destroy());

  it('moves rows that fell into the default partition into a new month', async () => {
    const start = monthStart(new Date(), 6);
    await db.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name, occurred_at)
      VALUES (1, 'f0000000-0000-4000-8000-000000000001', 'p'.repeat(32), 'web', 'shop_browser', 'development', 'view_item', $1)`, [new Date(start.getTime() + 3600_000)]);
    expect(await ensurePartition(db, start)).toBe(true);
    const [r] = await db.query(`SELECT tableoid::regclass::text AS part FROM marketing_events WHERE event_id = 'f0000000-0000-4000-8000-000000000001'`);
    expect(r.part).toBe(partitionName(start));
    expect(await ensurePartition(db, start)).toBe(false);
    await db.query(`DROP TABLE ${partitionName(start)}`);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts event-partitions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `event-partitions.ts`:

```ts
import type { DataSource } from 'typeorm';

const DAY = 86_400_000;
const NAME = /^marketing_events_(\d{4})_(\d{2})$/;
export const monthStart = (d: Date, add = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
export const partitionName = (start: Date) => `marketing_events_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;

/** Monthly partitions whose whole range is older than keepDays (spec §13). */
export function expiredPartitions(names: string[], now: Date, keepDays = 90): string[] {
  return names.filter((n) => {
    const m = NAME.exec(n);
    if (!m) return false;
    const end = Date.UTC(Number(m[1]), Number(m[2]), 1); // month index m[2] (1-based) = the next month 0-based
    return end <= now.getTime() - keepDays * DAY;
  });
}

/**
 * Creates the month's partition if missing. Rows that landed in the default partition for that month (a missed
 * nightly run) are moved in the same transaction — Postgres refuses to attach a range the default already holds.
 * Range literals come from Date arithmetic here, never from input.
 */
export async function ensurePartition(db: DataSource, start: Date): Promise<boolean> {
  const name = partitionName(start);
  if ((await db.query(`SELECT 1 FROM pg_class WHERE relname = $1`, [name])).length) return false;
  const from = start.toISOString(); const to = monthStart(start, 1).toISOString();
  await db.transaction(async (m) => {
    await m.query(`CREATE TEMP TABLE marketing_events_moving ON COMMIT DROP AS
      SELECT * FROM marketing_events_default WHERE occurred_at >= '${from}' AND occurred_at < '${to}'`);
    await m.query(`DELETE FROM marketing_events_default WHERE occurred_at >= '${from}' AND occurred_at < '${to}'`);
    await m.query(`CREATE TABLE ${name} PARTITION OF marketing_events FOR VALUES FROM ('${from}') TO ('${to}')`);
    await m.query(`INSERT INTO marketing_events SELECT * FROM marketing_events_moving`);
  });
  return true;
}

export async function dropExpiredPartitions(db: DataSource, now: Date): Promise<string[]> {
  const names = (await db.query(`SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'marketing_events'`)).map((r: { relname: string }) => r.relname);
  const expired = expiredPartitions(names, now);
  for (const n of expired) await db.query(`DROP TABLE ${n}`); // n matched NAME above
  await db.query(`DELETE FROM marketing_events_default WHERE occurred_at < $1`, [new Date(now.getTime() - 90 * DAY)]);
  return expired;
}

/**
 * For system health (spec §13). ponytail: exact count(*) is fine at this volume — switch to pg_class.reltuples
 * when the table passes a few million rows.
 */
export async function eventStoreHealth(db: DataSource): Promise<{ rows: number; totalBytes: number; oldestAt: string | null; defaultPartitionRows: number }> {
  const [r] = await db.query(`SELECT (SELECT count(*)::int FROM marketing_events) AS rows,
      (SELECT COALESCE(sum(pg_total_relation_size(i.inhrelid)), 0)::bigint FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'marketing_events') AS total_bytes,
      (SELECT min(occurred_at) FROM marketing_events) AS oldest_at, (SELECT count(*)::int FROM marketing_events_default) AS default_rows`);
  return { rows: r.rows, totalBytes: Number(r.total_bytes), oldestAt: r.oldest_at ? new Date(r.oldest_at).toISOString() : null, defaultPartitionRows: r.default_rows };
}
```

`application/event-retention.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dropExpiredPartitions, ensurePartition, eventStoreHealth, monthStart } from '../infrastructure/event-partitions';

/** Same switch as the workflow sweep: off only with CRON_MARKETING_WORKFLOW_ENABLED=false|0. */
const enabled = () => !['false', '0'].includes((process.env.CRON_MARKETING_WORKFLOW_ENABLED ?? '').trim().toLowerCase());
const LOCK = `hashtext('marketing-event-retention')`;

/** Nightly (spec §13): partitions ahead, yesterday's rollup, expired partitions, old action / guest-push logs. Every step is repeatable. */
@Injectable()
export class EventRetention {
  private readonly logger = new Logger(EventRetention.name);
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Bangkok' })
  async nightly(): Promise<void> {
    if (!enabled()) return;
    try { await this.run(); } catch (e) { this.logger.error(`marketing event retention: ${e instanceof Error ? e.stack : e}`); }
  }

  async run(now = new Date()): Promise<void> {
    const lock = this.db.createQueryRunner();
    await lock.connect();
    try {
      const [{ locked }] = await lock.query(`SELECT pg_try_advisory_lock(${LOCK}) AS locked`);
      if (!locked) return; // another instance is running it
      try {
        const created: string[] = [];
        for (let i = 0; i < 3; i++) if (await ensurePartition(this.db, monthStart(now, i))) created.push(String(i));
        const yesterday = new Date(now.getTime() + 7 * 3600_000 - 86_400_000).toISOString().slice(0, 10); // Bangkok date (UTC+7, no DST)
        await this.db.query(`INSERT INTO marketing_event_daily (date, name, platform, events, users, devices)
          SELECT $1::date, name, platform, count(*)::int, count(DISTINCT attributed_user_id)::int, count(DISTINCT device_id)::int FROM marketing_events
          WHERE occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Bangkok') AND occurred_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
          GROUP BY name, platform
          ON CONFLICT (date, name, platform) DO UPDATE SET events = EXCLUDED.events, users = EXCLUDED.users, devices = EXCLUDED.devices`, [yesterday]);
        const dropped = await dropExpiredPartitions(this.db, now);
        const logs = await this.deleteBatched(`DELETE FROM marketing_workflow_action_logs WHERE id IN (SELECT id FROM marketing_workflow_action_logs
          WHERE created_at < now() - interval '180 days' LIMIT 5000)`);
        await this.db.query(`DELETE FROM marketing_guest_push_log WHERE sent_at < now() - interval '7 days'`);
        const health = await eventStoreHealth(this.db);
        this.logger.log(`marketing events: created ${created.length} partition(s), dropped ${dropped.join(', ') || 'none'}, action logs deleted ${logs}, ${JSON.stringify(health)}`);
      } finally {
        await lock.query(`SELECT pg_advisory_unlock(${LOCK})`);
      }
    } finally {
      await lock.release();
    }
  }

  private async deleteBatched(sql: string): Promise<number> {
    let total = 0;
    for (;;) {
      const [, affected] = (await this.db.query(sql)) as [unknown, number];
      total += affected ?? 0;
      if (!affected || affected < 5000) return total;
    }
  }
}
```

Add `EventRetention` to the module's `providers`.

In `system-health.ts` `report()`: import `eventStoreHealth` from `../../marketing-events/infrastructure/event-partitions`; before `return` add

```ts
    const marketingEvents = await eventStoreHealth(this.db).catch((error) => ({ available: false, reason: String(error instanceof Error ? error.message : error) }));
    const problems = problemsNow.map((p) => p.message);
    if ('defaultPartitionRows' in marketingEvents && marketingEvents.defaultPartitionRows > 0)
      problems.push(`marketing_events: ${marketingEvents.defaultPartitionRows} แถวอยู่ใน default partition (job สร้าง partition พลาด — รอบถัดไปย้ายให้)`);
```

and return `{ period: range.label, now: { ok: problems.length === 0, problems }, commerce, josh, joshErpInbound, marketingEvents }`.

- [ ] **Step 4: Run the tests**

Run: `npx jest -c apps/commerce-platform/jest.config.cts event-partitions system-health`
Expected: PASS (DB spec skipped without `MARKETING_TEST_DATABASE_URL`; run it if a migrated local DB exists).

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-events apps/commerce-platform/src/modules/integration/connector/josh/system-health.ts
git commit -m "feat(marketing-events): monthly partitions, nightly retention and rollup, health"
```

### Task 9: Workflow validation, schemas and service for event steps

**Files:**
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/domain/workflow.validator.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/presentation/workflow.schemas.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/application/workflow.service.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/domain/template.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/marketing-workflow.module.ts`
- Test: `.../domain/workflow.validator.spec.ts`, `.../domain/template.spec.ts`, `.../application/workflow.service.spec.ts`

**Interfaces:**
- Consumes: `filterIssues`, `isFromTrigger`, `Types` (Task 3); `ruleIssues`, `typesOf`, `RuleContext` (Task 4); `EventRuleService.context()`, `DynamicSegmentsService.list()` (Task 7); `eventFilterSchema`, `eventRuleSchema` (Task 7).
- Produces: `interface EventContext extends RuleContext { segmentProblems: Map<string, string[]> }`; `validateWorkflow(w: WorkflowInput, ctx?: EventContext): WorkflowIssue[]`; `eventVars(ev: TriggerEvent | null, device: { id: string; platform: string } | null): Record<string, string>`; template variables may contain dots (`{{event.item_id}}`).

- [ ] **Step 1: Write the failing tests** — append to `workflow.validator.spec.ts`:

```ts
import type { EventDefinition } from '@cp/marketing-workflow';
import type { EventContext } from './workflow.validator';

const cart: EventDefinition = { name: 'add_to_cart', label: '', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'order_id', type: 'string', label: '' }, { key: 'price', type: 'number', label: '' }] };
const buy: EventDefinition = { ...cart, name: 'purchase' };
const ctx: EventContext = { catalog: new Map([[cart.name, cart], [buy.name, buy]]), coverageStart: new Date('2026-08-01T00:00:00Z'),
  segmentIds: new Set([id(50)]), segmentProblems: new Map([[id(50), []]]), now: new Date('2026-10-10T00:00:00Z') };
const eventTrigger = (over: object = {}): Partial<WorkflowInput> => ({ triggerType: 'event', triggerConfig: { eventName: 'add_to_cart', filters: [], includeGuests: false, ...over } as never });
const waitEvent = (n: number, over: object = {}): WorkflowStep => ({ id: id(n), type: 'wait_event', eventName: 'purchase', filters: [], timeoutHours: 2, matchedNextId: null, timeoutNextId: null, ...over } as WorkflowStep);
const ecodes = (w: WorkflowInput) => validateWorkflow(w, ctx).map((i) => i.code);

describe('validateWorkflow — event layer', () => {
  it('accepts add_to_cart → wait purchase (same order_id) → push', () => {
    const w = base([waitEvent(1, { filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], timeoutNextId: id(2) }), notify(2)], eventTrigger());
    expect(validateWorkflow(w, ctx)).toEqual([]);
  });

  it('fromTrigger needs an event trigger and a matching attribute type', () => {
    expect(ecodes(base([waitEvent(1, { filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }] })]))).toContain('wait_event_filter');
    expect(ecodes(base([waitEvent(1, { filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'price' } }] })], eventTrigger()))).toContain('wait_event_filter');
  });

  it('checks the trigger, timeouts, unknown events and the combined wait / condition limits', () => {
    expect(codes(base([notify(1)], { triggerType: 'event', triggerConfig: {} as never }))).toContain('trigger_config');
    expect(codes(base([waitEvent(1, { timeoutHours: 0 })], eventTrigger()))).toContain('wait_event_timeout');
    expect(ecodes(base([waitEvent(1, { eventName: 'nope' })], eventTrigger()))).toContain('event_unknown');
    const chain = [1, 2, 3, 4].map((n) => (n % 2 ? waitEvent(n, { timeoutNextId: id(n + 1) }) : ({ id: id(n), type: 'wait', hours: 1, nextId: n < 4 ? id(n + 1) : null } as WorkflowStep)));
    expect(codes(base(chain, eventTrigger()))).toContain('too_many_waits');
  });

  it('guests: no audience, event condition or customer conditions', () => {
    const guests = eventTrigger({ includeGuests: true });
    expect(codes(base([{ id: id(1), type: 'audience', nextId: null }], guests))).toContain('guest_audience');
    expect(codes(base([{ id: id(1), type: 'condition', expression: 'still_no_order == true', yesNextId: null, noNextId: null }], guests))).toContain('guest_condition');
    expect(codes(base([{ id: id(1), type: 'condition', expression: 'time.hour >= 9', yesNextId: null, noNextId: null }], guests))).toEqual([]);
  });

  it('a coupon on an event trigger needs a cooldown', () => {
    const coupon: WorkflowStep = { id: id(1), type: 'action', action: { kind: 'grant_coupon', couponId: id(70) }, nextId: null };
    expect(codes(base([coupon], eventTrigger()))).toContain('event_coupon_cooldown');
    expect(codes(base([coupon], { ...eventTrigger(), cooldownDays: 1 }))).toEqual([]);
  });

  it('event rules in audience / event_split use the rule checks and dynamic segments must be clean', () => {
    const rule = { kind: 'event', name: 'add_to_cart', measure: 'count', op: 'eq', value: 0, window: { lastDays: 90 }, filters: [] } as never;
    expect(ecodes(base([{ id: id(1), type: 'event_split', rule, yesNextId: null, noNextId: null }]))).toEqual(['event_rule']); // 90 days > coverage
    const dirty: EventContext = { ...ctx, segmentProblems: new Map([[id(50), ['x']]]) };
    expect(validateWorkflow(base([{ id: id(1), type: 'audience', dynamicSegmentIds: [id(50)], nextId: null }]), dirty).map((i) => i.code)).toEqual(['dynamic_segment']);
  });
});
```

Append to `template.spec.ts`:

```ts
import { eventVars } from './template';

it('renders event and device variables with dots in the name', () => {
  const vars = { ...eventVars({ eventId: 'e', name: 'add_to_cart', attributes: { item_id: 'SKU "1"', price: 10 } }, { id: 'd1', platform: 'web' }) };
  expect(renderTemplate('{"sku":"{{event.item_id}}","p":{{event.price}},"d":"{{device.id}}"}', vars, 'json')).toBe('{"sku":"SKU \\"1\\"","p":10,"d":"d1"}');
  expect(renderTemplate('{{event.missing}}', vars, 'text')).toBe('{{event.missing}}');
});
```

In `workflow.service.spec.ts` change the constructor call in `setup()` (the service now also takes the rule service and the dynamic segments service):

```ts
  const rules = { context: jest.fn(async () => ({ catalog: new Map(), coverageStart: null, segmentIds: new Set<string>(), now: new Date() })) };
  const dynamic = { list: jest.fn(async () => []) };
  const svc = new WorkflowService(workflows as never, revisions as never, segments as never, { query: jest.fn(async () => []) } as never, rules as never, dynamic as never);
```

and add:

```ts
  it('the editor payload with event steps parses', () => {
    const steps = [{ id: id(1), type: 'wait_event', eventName: 'purchase', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }],
      timeoutHours: 2, matchedNextId: null, timeoutNextId: null },
      { id: id(2), type: 'event_split', rule: { op: 'AND', children: [{ kind: 'segment', segmentId: id(3) }] }, yesNextId: null, noNextId: null }];
    expect(workflowInputSchema.safeParse({ ...valid, triggerType: 'event', triggerConfig: { eventName: 'add_to_cart', filters: [], includeGuests: true },
      entryStepId: id(1), steps, exitOnGoal: { kind: 'event', eventName: 'purchase', filters: [] } }).success).toBe(true);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow/domain workflow.service`
Expected: FAIL — `EventContext` / `eventVars` missing, new codes absent, schema rejects the new steps.

- [ ] **Step 3: Implement**

`workflow.validator.ts` — new imports and context type:

```ts
import { filterIssues, isFromTrigger, type Types } from '../../marketing-events/domain/event-filter';
import { ruleIssues, typesOf, type RuleContext } from '../../marketing-events/domain/event-rule';
import type { EventFilter, EventTriggerConfig } from './workflow.types';

/** What event checks need from IO (catalog, coverage, dynamic segments and their own problems). Absent → structural checks only. */
export interface EventContext extends RuleContext { segmentProblems: Map<string, string[]> }
```

`validateWorkflow(w, ctx?)`: replace the three `count(...)` limit lines with

```ts
  const count = (...t: WorkflowStep['type'][]) => w.steps.filter((s) => t.includes(s.type)).length;
  if (count('audience') > LIMITS.maxAudienceSteps) add(null, 'too_many_audiences', 'มี Audience filter ได้ 1 อัน');
  if (count('wait', 'wait_event') > LIMITS.maxWaitSteps) add(null, 'too_many_waits', `มี Time Delay ได้ไม่เกิน ${LIMITS.maxWaitSteps} อัน`);
  if (count('condition', 'event_split') > LIMITS.maxConditionSteps) add(null, 'too_many_conditions', `มี Condition ได้ไม่เกิน ${LIMITS.maxConditionSteps} อัน`);
```

and before `return issues;`:

```ts
  if (ctx) eventIssues(w, ctx, add);
  guestIssues(w, add);
  if (w.triggerType === 'event' && w.cooldownDays < 1 && w.steps.some((s) => s.type === 'action' && s.action.kind === 'grant_coupon'))
    add(null, 'event_coupon_cooldown', 'workflow ที่เริ่มด้วย event และแจกคูปองต้องตั้ง cooldown อย่างน้อย 1 วัน (event มาจากเครื่องลูกค้า ปลอมได้)');
```

`validateTrigger` — insert before the final `else if`:

```ts
  } else if (w.triggerType === 'event') {
    if (typeof c.eventName !== 'string' || !c.eventName) add(null, 'trigger_config', 'เลือก event ที่เริ่ม workflow');
    if (!Array.isArray(c.filters)) add(null, 'trigger_config', 'เงื่อนไข attribute ไม่ถูกต้อง');
    else if ((c.filters as EventFilter[]).some((f) => isFromTrigger(f.value))) add(null, 'trigger_filter', 'เงื่อนไขของ trigger ใช้ค่าจาก event ที่ trigger ไม่ได้');
    if (typeof c.includeGuests !== 'boolean') add(null, 'trigger_config', 'ตั้งค่า "รวม guest"');
```

`validateStep` — two new cases:

```ts
    case 'wait_event': {
      const total = (s.timeoutHours ?? 0) * 60 + (s.timeoutMinutes ?? 0);
      if (!isInt(s.timeoutHours, 0, LIMITS.maxWaitMinutes) || !isInt(s.timeoutMinutes ?? 0, 0, 59) || total < 1 || total > LIMITS.maxWaitMinutes)
        add('wait_event_timeout', 'รอได้ 1 นาที ถึง 30 วัน');
      if (!s.eventName) add('wait_event_name', 'เลือก event ที่รอ');
      return;
    }
    case 'event_split':
      if (!s.rule) add('event_split_rule', 'ตั้งเงื่อนไข event');
      return;
```

New functions at the bottom:

```ts
function eventIssues(w: WorkflowInput, ctx: EventContext, add: Add) {
  const defOf = (name: string, stepId: string | null) => {
    const d = ctx.catalog.get(name);
    if (!d || d.status !== 'active') { add(stepId, 'event_unknown', `ไม่มี event "${name}" ใน catalog`); return null; }
    return d;
  };
  const trig = w.triggerType === 'event' ? (w.triggerConfig as EventTriggerConfig) : null;
  const trigDef = trig?.eventName ? defOf(trig.eventName, null) : null;
  const trigTypes: Types | null = trigDef ? typesOf(trigDef) : null;
  if (trigDef && Array.isArray(trig?.filters)) for (const m of filterIssues(trig!.filters, typesOf(trigDef), null)) add(null, 'trigger_filter', m);
  if (w.exitOnGoal?.kind === 'event') {
    const d = defOf(w.exitOnGoal.eventName, null);
    if (d) for (const m of filterIssues(w.exitOnGoal.filters ?? [], typesOf(d), trigTypes)) add(null, 'goal_filter', m);
  }
  for (const s of w.steps) {
    if (s.type === 'wait_event' && s.eventName) {
      const d = defOf(s.eventName, s.id);
      if (d) for (const m of filterIssues(s.filters ?? [], typesOf(d), trigTypes)) add(s.id, 'wait_event_filter', m);
    }
    if (s.type === 'event_split' && s.rule) for (const m of ruleIssues(s.rule, ctx)) add(s.id, 'event_rule', m);
    if (s.type === 'audience') {
      if (s.eventRule) for (const m of ruleIssues(s.eventRule, ctx)) add(s.id, 'event_rule', m);
      for (const sid of [...(s.dynamicSegmentIds ?? []), ...(s.excludeDynamicSegmentIds ?? [])]) {
        if (!ctx.segmentIds?.has(sid)) add(s.id, 'dynamic_segment', 'ไม่พบ dynamic segment');
        else if (ctx.segmentProblems.get(sid)?.length) add(s.id, 'dynamic_segment', 'dynamic segment ที่เลือกยังมีเงื่อนไขที่ต้องแก้');
      }
    }
  }
}

/** Guests have no customer data (spec §10): only time conditions, no audience or event rules. */
function guestIssues(w: WorkflowInput, add: Add) {
  if (w.triggerType !== 'event' || !(w.triggerConfig as EventTriggerConfig).includeGuests) return;
  for (const s of w.steps) {
    if (s.type === 'audience') add(s.id, 'guest_audience', 'workflow ที่รวม guest ใช้ Audience filter ไม่ได้ (guest ไม่มีข้อมูลลูกค้า)');
    if (s.type === 'event_split') add(s.id, 'guest_event_rule', 'workflow ที่รวม guest ใช้ Event condition ไม่ได้');
    if (s.type === 'condition' && /\b(segment\.in|user\.|still_no_order)/.test(s.expression ?? ''))
      add(s.id, 'guest_condition', 'workflow ที่รวม guest ใช้ได้แค่เงื่อนไขเวลา (time.*)');
  }
}
```

`template.ts` — widen the variable pattern and add the event / device variables:

```ts
const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
```

```ts
import type { TriggerEvent } from './workflow.types';

/** `{{event.name}}`, `{{event.<attribute>}}`, `{{device.id}}`, `{{device.platform}}` (spec §12). */
export function eventVars(ev: TriggerEvent | null, device: { id: string; platform: string } | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (ev) {
    out['event.name'] = ev.name;
    for (const [k, v] of Object.entries(ev.attributes ?? {})) if (v !== null && v !== undefined) out[`event.${k}`] = String(v);
  }
  if (device) { out['device.id'] = device.id; out['device.platform'] = device.platform; }
  return out;
}
```

and extend `TEMPLATE_VARS` with `{ key: 'event.name', label: 'ชื่อ event ที่เริ่ม workflow' }, { key: 'device.id', label: 'รหัสอุปกรณ์' }, { key: 'device.platform', label: 'แพลตฟอร์มของอุปกรณ์' }`.

`workflow.schemas.ts` — import `eventFilterSchema`, `eventRuleSchema` from `../../marketing-events/presentation/events.schemas`; then:

```ts
const uuidList = z.array(z.string()).max(50).optional();
// audience step:
  z.object({ id, type: z.literal('audience'), segmentIds: uuidList, excludeSegmentIds: uuidList, dynamicSegmentIds: uuidList,
    excludeDynamicSegmentIds: uuidList, eventRule: eventRuleSchema.nullable().optional(), nextId: next }).strict(),
// two new members of the discriminated union:
  z.object({ id, type: z.literal('wait_event'), eventName: z.string().max(64), filters: z.array(eventFilterSchema).max(10),
    timeoutHours: z.number().int().min(0).max(100_000), timeoutMinutes: z.number().int().min(0).max(59).optional(), matchedNextId: next, timeoutNextId: next }).strict(),
  z.object({ id, type: z.literal('event_split'), rule: eventRuleSchema, yesNextId: next, noNextId: next }).strict(),
// workflowInputSchema:
  triggerType: z.enum(['scheduled', 'order_milestone', 'first_login', 'app_login', 'event']),
  exitOnGoal: z.union([z.object({ kind: z.literal('order_placed') }).strict(),
    z.object({ kind: z.literal('event'), eventName: z.string().max(64), filters: z.array(eventFilterSchema).max(10) }).strict()]).nullable(),
// testRunSchema:
export const testRunSchema = z.object({ userId: z.string().uuid(), skipWaits: z.boolean(), eventAttributes: z.record(z.string(), z.unknown()).optional() }).strict();
```

`workflow.service.ts` — constructor gains `private readonly rules: EventRuleService, private readonly dynamicSegments: DynamicSegmentsService` (imports from `../../marketing-events/application/...`); `issuesOf` builds the context once:

```ts
  async issuesOf(row: MarketingWorkflowRow): Promise<WorkflowIssue[]> {
    const dynamic = await this.dynamicSegments.list();
    const ctx: EventContext = { ...(await this.rules.context()), segmentIds: new Set(dynamic.map((d) => d.id)),
      segmentProblems: new Map(dynamic.map((d) => [d.id, d.issues])) };
    const issues = validateWorkflow(inputOf(row), ctx);
    // … the existing evaluable-segment and webhook checks stay as they are
```

`marketing-workflow.module.ts`: add `MarketingEventsModule` to `imports`.

- [ ] **Step 4: Run the tests**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow/domain workflow.service`
Expected: PASS (all old validator / template / service tests still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-workflow
git commit -m "feat(marketing-workflow): validate event trigger, wait_event, event_split, event goals and guest rules"
```

### Task 10: Engine and store — guests, Wait for event, event rules, event goals

**Files:**
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/infrastructure/workflow.store.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/application/workflow-engine.service.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/application/marketing-events.ts`
- Test: `.../application/workflow-engine.spec.ts`, `.../infrastructure/workflow.store.db.spec.ts`

**Interfaces:**
- Consumes: `matchesFilters` (Task 3), `EventRuleService.matches / segmentMatches / typesOf` (Task 7), `eventVars`, `GUEST_PUSH_DAILY_CAP` (Task 1, 9).
- Produces:
  - `EnrollmentRecord` gains `userId: string | null; deviceId: string | null; waitingFor: WaitingFor | null; triggerEvent: TriggerEvent | null`
  - `type Who = { userId: string | null; deviceId: string | null }`
  - store: `insertEnrollment(i: { workflowId; userId: string | null; deviceId: string | null; occurrenceKey; entryStepId; holdout; test; skipWaits; triggerEvent: TriggerEvent | null })`, `inCooldown(workflowId, who: Who, days)`, `parkForEvent(m, id, stepId, waitingFor, resumeAt)`, `clearWait(m, id)`, `lockWaiting(m, id, stepId)`, `moveAfterEvent(m, id, nextId)`, `waitingFor(who, eventName, occurredAt)`, `eventsSince(m, who, eventName, since)`, `devicePush(m, deviceId)`, `guestPushesLast24h(m, deviceId)`, `logGuestPush(m, deviceId)`, `eventGoalCandidates(who, eventName, occurredAt)`, `markConvertedAt(id, at)`, `eventsByIds(ids)`
  - engine: `enroll(wf, target: string | Who, occurrenceKey, opts?: { test?: boolean; skipWaits?: boolean; triggerEvent?: TriggerEvent | null })`, `resumeFromEvent(enrollmentId: string, stepId: string, eventId: string): Promise<void>`
  - `MarketingNotifyPayload` gains `target?: { kind: 'device'; subscriptionId: string; platform: string }` and `userId: string | null`

- [ ] **Step 1: Write the failing tests** — in `workflow-engine.spec.ts` update `setup()`:
  - `wf` gets `triggerConfig: over.triggerConfig ?? {}` and `triggerType: over.triggerType ?? 'first_login'`;
  - store fake gains (keep everything else):

```ts
    parkForEvent: jest.fn(async (_m: unknown, eid: string, stepId: string, waitingFor: unknown, resumeAt: Date) => {
      Object.assign(enrollments.get(eid)!, { status: 'running', currentStepId: stepId, resumeAt, waitingFor }); }),
    clearWait: jest.fn(async (_m: unknown, eid: string) => { Object.assign(enrollments.get(eid)!, { waitingFor: null }); }),
    lockWaiting: jest.fn(async (_m: unknown, eid: string, stepId: string) => {
      const e = enrollments.get(eid);
      return e && e.status === 'running' && e.currentStepId === stepId && e.waitingFor?.stepId === stepId ? { ...e } : null; }),
    moveAfterEvent: jest.fn(async (_m: unknown, eid: string, nextId: string | null) => {
      Object.assign(enrollments.get(eid)!, { currentStepId: nextId, waitingFor: null, resumeAt: null }); }),
    eventsSince: jest.fn(async () => over.events ?? []),
    devicePush: jest.fn(async () => over.device ?? null),
    guestPushesLast24h: jest.fn(async () => over.guestPushes ?? 0),
    logGuestPush: jest.fn(async () => undefined),
```

  - `insertEnrollment` fake stores `userId: i.userId, deviceId: i.deviceId, waitingFor: null, triggerEvent: i.triggerEvent ?? null`, dedupes on `(userId ?? deviceId, occurrenceKey)`;
  - `const rules = { matches: jest.fn(async () => !!over.ruleMatches), segmentMatches: jest.fn(async () => false), typesOf: jest.fn(async () => ({ order_id: 'string' })) };` passed as the last constructor argument;
  - `over` type gains `triggerType?, triggerConfig?, events?, device?, guestPushes?, ruleMatches?`; `run(occurrence, opts, target = U)` passes `target` to `enroll`.

Then add:

```ts
  describe('event layer', () => {
    const D = 'd'.repeat(32);
    const waitEvent = (n: number, matched: string | null, timeout: string | null): WorkflowStep =>
      ({ id: id(n), type: 'wait_event', eventName: 'purchase', filters: [], timeoutHours: 2, matchedNextId: matched, timeoutNextId: timeout } as WorkflowStep);

    it('Wait for event: parks on the step, an event moves it to the matched branch', async () => {
      const s = setup([waitEvent(1, id(2), id(3)), notify(2, null), notify(3, null)]);
      const eid = await s.run();
      expect(s.enrollments.get(eid)).toMatchObject({ status: 'running', currentStepId: id(1), waitingFor: { stepId: id(1), eventName: 'purchase' } });
      await s.engine.resumeFromEvent(eid, id(1), 'ev1');
      expect(s.queue.step).toHaveBeenLastCalledWith(eid);
      await s.engine.process(eid);
      expect(s.logs.map((l) => [l.stepId, l.kind, l.meta.matched ?? l.meta.templateKey])).toEqual([[id(1), 'wait_event', true], [id(2), 'notify', 'custom_a']]);
    });

    it('Wait for event: a timeout takes the timeout branch; an event after the timeout is ignored', async () => {
      const s = setup([waitEvent(1, id(2), id(3)), notify(2, null), notify(3, null)]);
      const eid = await s.run();
      await s.resume(eid);
      await s.engine.resumeFromEvent(eid, id(1), 'late');
      expect(s.logs.map((l) => [l.stepId, l.kind])).toEqual([[id(1), 'wait_event'], [id(3), 'notify']]);
      expect(s.logs[0].meta).toEqual({ matched: false });
    });

    it('event goal: a matching event since the start ends the journey', async () => {
      const s = setup([notify(1, null)], { exitOnGoal: { kind: 'event', eventName: 'purchase', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }] },
        events: [{ attributes: { order_id: 'O1' } }] });
      const eid = await s.run('ev-1', { triggerEvent: { eventId: 'ev-1', name: 'add_to_cart', attributes: { order_id: 'O1' } } });
      expect(s.enrollments.get(eid)?.endReason).toBe('goal_reached');
      const other = setup([notify(1, null)], { exitOnGoal: { kind: 'event', eventName: 'purchase', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }] },
        events: [{ attributes: { order_id: 'O2' } }] });
      const eid2 = await other.run('ev-1', { triggerEvent: { eventId: 'ev-1', name: 'add_to_cart', attributes: { order_id: 'O1' } } });
      expect(other.enrollments.get(eid2)?.status).toBe('completed');
    });

    it('event_split goes Yes when the rule matches', async () => {
      const split: WorkflowStep = { id: id(1), type: 'event_split', rule: { kind: 'segment', segmentId: id(9) }, yesNextId: id(2), noNextId: null } as WorkflowStep;
      const s = setup([split, notify(2, null)], { ruleMatches: true });
      await s.run();
      expect(s.logs.map((l) => l.kind)).toEqual(['event_split', 'notify']);
    });

    it('guest: push to the device with the event data, once per 24 h; coupon and email are skipped', async () => {
      const coupon: WorkflowStep = { id: id(2), type: 'action', action: { kind: 'grant_coupon', couponId: id(70) }, nextId: id(3) };
      const email: WorkflowStep = { id: id(3), type: 'action', action: { kind: 'notify', channels: ['email'], templateKey: 'custom_b' }, nextId: null };
      const s = setup([notify(1, id(2)), coupon, email], { triggerType: 'event', device: { pushSubscriptionId: '5b000000-0000-4000-8000-000000000001', platform: 'web' } });
      const trig = { eventId: 'ev-1', name: 'add_to_cart', attributes: { item_id: 'SKU-1' } };
      await s.run('ev-1', { triggerEvent: trig }, { userId: null, deviceId: D });
      expect(s.events.publish).toHaveBeenCalledTimes(1);
      const [event] = (s.events.publish.mock.calls[0] as unknown[]) as [{ aggregateId: string; payload: Record<string, unknown> }];
      expect(event.aggregateId).toBe(D);
      expect(event.payload).toMatchObject({ userId: null, channels: ['push'], target: { kind: 'device', subscriptionId: '5b000000-0000-4000-8000-000000000001', platform: 'web' },
        data: { event: { item_id: 'SKU-1' } } });
      expect(s.logs.map((l) => [l.kind, l.status, l.meta.reason ?? null])).toEqual([['notify', 'queued', null], ['grant_coupon', 'skipped', 'guest_no_user'], ['notify', 'skipped', 'guest_channel']]);
      const capped = setup([notify(1, null)], { triggerType: 'event', device: { pushSubscriptionId: '5b000000-0000-4000-8000-000000000001', platform: 'web' }, guestPushes: 1 });
      await capped.run('ev-2', { triggerEvent: trig }, { userId: null, deviceId: D });
      expect(capped.logs[0]).toMatchObject({ status: 'skipped', meta: { reason: 'guest_cap' } });
    });
  });
```

Append to `workflow.store.db.spec.ts` (inside its `describe`):

```ts
  it('guest enrollments dedupe per device; lockWaiting only finds an enrollment still waiting on that step', async () => {
    const D = 'g'.repeat(32);
    const a = await store.insertEnrollment({ workflowId: wf, userId: null, deviceId: D, occurrenceKey: 'ev1', entryStepId: 's1', holdout: false, test: false, skipWaits: false, triggerEvent: null });
    expect(await store.insertEnrollment({ workflowId: wf, userId: null, deviceId: D, occurrenceKey: 'ev1', entryStepId: 's1', holdout: false, test: false, skipWaits: false, triggerEvent: null })).toBeNull();
    await db.transaction((m) => store.parkForEvent(m, a!, 's1', { stepId: 's1', eventName: 'purchase', filters: [], since: new Date().toISOString() }, new Date(Date.now() + 60_000)));
    expect((await store.waitingFor({ userId: null, deviceId: D }, 'purchase', new Date())).map((r) => r.id)).toEqual([a]);
    await db.transaction(async (m) => expect(await store.lockWaiting(m, a!, 's1')).toMatchObject({ deviceId: D }));
    await db.transaction((m) => store.moveAfterEvent(m, a!, 's2'));
    await db.transaction(async (m) => expect(await store.lockWaiting(m, a!, 's1')).toBeNull());
  });
```

Existing callers of the old `inCooldown(workflowId, userId, days)` in `workflow.store.db.spec.ts` change to `inCooldown(workflowId, { userId, deviceId: null }, days)`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow-engine`
Expected: FAIL — `resumeFromEvent is not a function` / new store calls missing.

- [ ] **Step 3: Implement the store** (`workflow.store.ts`):

```ts
import type { OrderMilestoneTriggerConfig, TriggerEvent, TriggerType, WaitingFor, WebhookHeader, ExitGoal } from '../domain/workflow.types';

export type Who = { userId: string | null; deviceId: string | null };
export interface EnrollmentRecord {
  id: string; workflowId: string; userId: string | null; deviceId: string | null; occurrenceKey: string; status: string; currentStepId: string | null;
  resumeAt: Date | null; isHoldout: boolean; isTest: boolean; skipWaits: boolean; splitAssignments: Record<string, string>; startedAt: Date;
  waitingFor: WaitingFor | null; triggerEvent: TriggerEvent | null;
}
const toEnrollment = (r: Row): EnrollmentRecord => ({
  id: r.id as string, workflowId: r.workflow_id as string, userId: (r.user_id as string | null) ?? null, deviceId: (r.device_id as string | null) ?? null,
  occurrenceKey: r.occurrence_key as string, status: r.status as string, currentStepId: (r.current_step_id as string | null) ?? null,
  resumeAt: (r.resume_at as Date | null) ?? null, isHoldout: !!r.is_holdout, isTest: !!r.is_test, skipWaits: !!r.skip_waits,
  splitAssignments: (r.split_assignments as Record<string, string>) ?? {}, startedAt: new Date(r.started_at as string),
  waitingFor: (r.waiting_for as WaitingFor | null) ?? null, triggerEvent: (r.trigger_event as TriggerEvent | null) ?? null,
});
/** `$1` = user id, `$2` = device id; a guest (no user) is matched by its device. */
const WHO_SQL = `(($1::uuid IS NOT NULL AND user_id = $1) OR ($1::uuid IS NULL AND user_id IS NULL AND device_id = $2))`;
```

Replace `insertEnrollment` and `inCooldown`:

```ts
  async insertEnrollment(i: { workflowId: string; userId: string | null; deviceId: string | null; occurrenceKey: string; entryStepId: string | null;
    holdout: boolean; test: boolean; skipWaits: boolean; triggerEvent: TriggerEvent | null }): Promise<string | null> {
    const conflict = i.userId ? '(workflow_id, user_id, occurrence_key)' : '(workflow_id, device_id, occurrence_key) WHERE user_id IS NULL';
    const rows = await this.db.query(
      `INSERT INTO marketing_workflow_enrollments (workflow_id, user_id, device_id, occurrence_key, status, current_step_id, is_holdout, is_test, skip_waits,
         completed_at, end_reason, trigger_event)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN 'holdout' END, $10::jsonb)
       ON CONFLICT ${conflict} DO NOTHING RETURNING id`,
      [i.workflowId, i.userId, i.userId ? null : i.deviceId, i.occurrenceKey, i.holdout ? 'completed' : 'pending', i.holdout ? null : i.entryStepId,
        i.holdout, i.test, i.skipWaits, i.triggerEvent ? JSON.stringify(i.triggerEvent) : null]);
    return rows[0]?.id ?? null;
  }

  async inCooldown(workflowId: string, who: Who, days: number): Promise<boolean> {
    const [r] = await this.db.query(`SELECT EXISTS (SELECT 1 FROM marketing_workflow_enrollments WHERE workflow_id = $3 AND ${WHO_SQL} AND NOT is_test
      AND started_at > now() - make_interval(days => $4)) AS hit`, [who.userId, who.deviceId, workflowId, days]);
    return !!r?.hit;
  }
```

New methods:

```ts
  async parkForEvent(m: EntityManager, id: string, stepId: string, waitingFor: WaitingFor, resumeAt: Date) {
    await m.query(`UPDATE marketing_workflow_enrollments SET status = 'running', current_step_id = $2, waiting_for = $3::jsonb, resume_at = $4 WHERE id = $1`,
      [id, stepId, JSON.stringify(waitingFor), resumeAt]);
  }
  async clearWait(m: EntityManager, id: string) {
    await m.query(`UPDATE marketing_workflow_enrollments SET waiting_for = NULL WHERE id = $1`, [id]);
  }
  /** Waits for a row lock (not SKIP LOCKED): an event that races the timeout queues behind it and then finds nothing to do. */
  async lockWaiting(m: EntityManager, id: string, stepId: string): Promise<EnrollmentRecord | null> {
    const [r] = await m.query(`SELECT * FROM marketing_workflow_enrollments WHERE id = $1 AND status = 'running' AND current_step_id = $2
      AND waiting_for->>'stepId' = $2 FOR UPDATE`, [id, stepId]);
    return r ? toEnrollment(r) : null;
  }
  async moveAfterEvent(m: EntityManager, id: string, nextId: string | null) {
    await m.query(`UPDATE marketing_workflow_enrollments SET current_step_id = $2, waiting_for = NULL, resume_at = NULL WHERE id = $1`, [id, nextId]);
  }
  async waitingFor(who: Who, eventName: string, occurredAt: Date): Promise<{ id: string; waitingFor: WaitingFor; triggerEvent: TriggerEvent | null }[]> {
    const rows = await this.db.query(`SELECT id, waiting_for, trigger_event FROM marketing_workflow_enrollments WHERE status = 'running'
      AND waiting_for->>'eventName' = $3 AND ${WHO_SQL} AND (waiting_for->>'since')::timestamptz <= $4`, [who.userId, who.deviceId, eventName, occurredAt]);
    return rows.map((r: Row) => ({ id: r.id as string, waitingFor: r.waiting_for as WaitingFor, triggerEvent: (r.trigger_event as TriggerEvent | null) ?? null }));
  }
  async eventsSince(m: EntityManager, who: Who, eventName: string, since: Date): Promise<{ attributes: Record<string, unknown> }[]> {
    const col = who.userId ? 'attributed_user_id = $1::uuid' : 'device_id = $1 AND attributed_user_id IS NULL';
    return m.query(`SELECT attributes FROM marketing_events WHERE ${col} AND name = $2 AND occurred_at >= $3 ORDER BY occurred_at LIMIT 200`,
      [who.userId ?? who.deviceId, eventName, since]);
  }
  async devicePush(m: EntityManager, deviceId: string): Promise<{ pushSubscriptionId: string | null; platform: string } | null> {
    const [r] = await m.query(`SELECT push_subscription_id, platform FROM marketing_devices WHERE device_id = $1`, [deviceId]);
    return r ? { pushSubscriptionId: r.push_subscription_id ?? null, platform: r.platform } : null;
  }
  async guestPushesLast24h(m: EntityManager, deviceId: string): Promise<number> {
    const [r] = await m.query(`SELECT count(*)::int AS n FROM marketing_guest_push_log WHERE device_id = $1 AND sent_at > now() - interval '24 hours'`, [deviceId]);
    return r?.n ?? 0;
  }
  async logGuestPush(m: EntityManager, deviceId: string) {
    await m.query(`INSERT INTO marketing_guest_push_log (device_id) VALUES ($1)`, [deviceId]);
  }
  /** Open conversions on an event goal (spec §9): started before the event, still inside the workflow's window. */
  async eventGoalCandidates(who: Who, eventName: string, occurredAt: Date): Promise<{ id: string; goal: Extract<ExitGoal, { kind: 'event' }>; triggerEvent: TriggerEvent | null }[]> {
    const rows = await this.db.query(`SELECT e.id, w.exit_on_goal, e.trigger_event FROM marketing_workflow_enrollments e JOIN marketing_workflows w ON w.id = e.workflow_id
      WHERE e.converted_at IS NULL AND NOT e.is_test AND w.exit_on_goal->>'kind' = 'event' AND w.exit_on_goal->>'eventName' = $3
        AND ${WHO_SQL.replace(/user_id/g, 'e.user_id').replace(/device_id/g, 'e.device_id')}
        AND e.started_at <= $4 AND $4 <= e.started_at + make_interval(days => w.conversion_window_days)`, [who.userId, who.deviceId, eventName, occurredAt]);
    return rows.map((r: Row) => ({ id: r.id as string, goal: r.exit_on_goal as Extract<ExitGoal, { kind: 'event' }>, triggerEvent: (r.trigger_event as TriggerEvent | null) ?? null }));
  }
  async markConvertedAt(id: string, at: Date) {
    await this.db.query(`UPDATE marketing_workflow_enrollments SET converted_at = $2 WHERE id = $1 AND converted_at IS NULL`, [id, at]);
  }
```

`application/marketing-events.ts` — payload:

```ts
/** To josh: deliver a notify template; josh dedupes on dedupeKey. Aggregate = the josh user, or the device for a guest (target). */
export interface MarketingNotifyPayload {
  userId: string | null; templateKey: string; channels: NotifyChannel[]; data: Record<string, unknown>; dedupeKey: string;
  target?: { kind: 'device'; subscriptionId: string; platform: string };
}
```

- [ ] **Step 4: Implement the engine** (`workflow-engine.service.ts`) — constructor gains `private readonly rules: EventRuleService` (last). Changes:

```ts
import { matchesFilters } from '../../marketing-events/domain/event-filter';
import { EventRuleService } from '../../marketing-events/application/event-rule.service';
import { eventVars, renderWebhook, webhookVars } from '../domain/template';
import { GUEST_PUSH_DAILY_CAP } from '../domain/workflow.types';
import type { TriggerEvent, WorkflowAction, WorkflowStep } from '../domain/workflow.types';
import { EnrollmentRecord, WorkflowStore, type Who } from '../infrastructure/workflow.store';

  /** Inserts the enrollment (once per workflow + user — or device for a guest — + occurrence) and queues its first run. Test runs skip the gates. */
  async enroll(wf: MarketingWorkflowRow, target: string | Who, occurrenceKey: string,
    opts: { test?: boolean; skipWaits?: boolean; triggerEvent?: TriggerEvent | null } = {}): Promise<string | null> {
    const who: Who = typeof target === 'string' ? { userId: target, deviceId: null } : { userId: target.userId ?? null, deviceId: target.userId ? null : target.deviceId ?? null };
    if (!who.userId && !who.deviceId) return null;
    if (!opts.test) {
      if (wf.status !== 'active') return null;
      if (!isWithinMarketingSchedule(wf.schedule, new Date())) return null;
      if (wf.cooldownDays > 0 && (await this.store.inCooldown(wf.id, who, wf.cooldownDays))) return null;
      if (who.userId && !(await this.passesAudience(wf, who.userId, this.db.manager))) return null;
    }
    const key = who.userId ?? `device:${who.deviceId}`;
    const holdout = !opts.test && wf.holdoutPercent > 0 && bucket(`holdout:${wf.id}:${key}:${occurrenceKey}`) < wf.holdoutPercent;
    const id = await this.store.insertEnrollment({ workflowId: wf.id, userId: who.userId, deviceId: who.deviceId, occurrenceKey, entryStepId: wf.entryStepId,
      holdout, test: !!opts.test, skipWaits: !!opts.skipWaits, triggerEvent: opts.triggerEvent ?? null });
    if (id && !holdout) this.queue.step(id);
    return id;
  }

  /** An awaited event arrived (spec §8): move to the matched branch unless the timeout already took the enrollment. */
  async resumeFromEvent(enrollmentId: string, stepId: string, eventId: string): Promise<void> {
    let moved = false;
    await this.db.transaction(async (m) => {
      const e = await this.store.lockWaiting(m, enrollmentId, stepId);
      if (!e) return;
      const wf = await this.store.workflow(m, e.workflowId);
      const step = wf?.steps.find((s) => s.id === stepId);
      if (!step || step.type !== 'wait_event') return; // edited away: the timeout run ends it as step_removed
      await this.store.log(m, e.id, stepId, 'wait_event', 'sent', { matched: true, eventId });
      await this.store.moveAfterEvent(m, e.id, step.matchedNextId);
      moved = true;
    });
    if (moved) this.queue.step(enrollmentId);
  }

  async passesAudience(wf: MarketingWorkflowRow, userId: string, m: EntityManager): Promise<boolean> {
    const a = wf.steps.find((s): s is Audience => s.type === 'audience');
    if (!a) return true;
    for (const sid of a.excludeSegmentIds ?? []) if (await this.segments.userMatchesSegment(sid, userId, m)) return false;
    for (const sid of a.excludeDynamicSegmentIds ?? []) if (await this.rules.segmentMatches(sid, userId, m)) return false;
    if (a.eventRule && !(await this.rules.matches(a.eventRule, userId, m))) return false;
    const dynamic = a.dynamicSegmentIds ?? [];
    if (dynamic.length) {
      let hit = false;
      for (const sid of dynamic) if (await this.rules.segmentMatches(sid, userId, m)) { hit = true; break; }
      if (!hit) return false;
    }
    const include = a.segmentIds ?? [];
    if (!include.length) return true;
    for (const sid of include) if (await this.segments.userMatchesSegment(sid, userId, m)) return true;
    return false;
  }
```

In `walk()`:
- the `action` / `webhook` audience check becomes `if (!e.isTest && e.userId && !(await this.passesAudience(wf, e.userId, m)))`;
- new cases:

```ts
        case 'wait_event': {
          if (e.waitingFor?.stepId === step.id) { // resumed by the timeout
            await this.store.clearWait(m, e.id);
            e.waitingFor = null;
            await this.store.log(m, e.id, step.id, 'wait_event', 'sent', { matched: false });
            id = step.timeoutNextId; break;
          }
          const minutes = step.timeoutHours * 60 + (step.timeoutMinutes ?? 0);
          if (e.skipWaits || minutes < 1) {
            await this.store.log(m, e.id, step.id, 'wait_event', 'sent', { matched: false });
            id = step.timeoutNextId; break;
          }
          const ms = minutes * 60_000;
          await this.store.parkForEvent(m, e.id, step.id, { stepId: step.id, eventName: step.eventName, filters: step.filters, since: new Date().toISOString() },
            new Date(Date.now() + ms));
          return ms;
        }
        case 'event_split': {
          const yes = !!e.userId && (await this.rules.matches(step.rule, e.userId, m));
          await this.store.log(m, e.id, step.id, 'event_split', 'sent', { result: yes });
          id = yes ? step.yesNextId : step.noNextId; break;
        }
```

- `goalReached`:

```ts
  private async goalReached({ m, wf, e }: Run): Promise<boolean> {
    const g = wf.exitOnGoal;
    if (!g) return false;
    if (g.kind === 'order_placed') return !!e.userId && (await this.store.hasCountedOrderSince(m, e.userId, e.startedAt));
    const rows = await this.store.eventsSince(m, { userId: e.userId, deviceId: e.deviceId }, g.eventName, e.startedAt);
    if (!rows.length) return false;
    const types = await this.rules.typesOf(g.eventName);
    return rows.some((r) => matchesFilters(r.attributes, g.filters ?? [], types, e.triggerEvent?.attributes ?? null));
  }
```

- `condition()`: first line `if (!e.userId) return false;` and use `e.userId` (now narrowed) in the existing calls.
- `action()`:

```ts
  private async action(r: Run, stepId: string, a: WorkflowAction): Promise<void> {
    const { m, wf, e } = r;
    if (!e.userId) return this.guestAction(r, stepId, a);
    if (a.kind === 'notify') {
      if (!e.isTest && (await this.capReached(m, e.userId))) {
        await this.store.log(m, e.id, stepId, 'notify', 'skipped', { reason: 'frequency_cap', templateKey: a.templateKey });
        return;
      }
      await this.events.publish(new MarketingNotifyRequested(e.userId, { userId: e.userId, templateKey: a.templateKey, channels: a.channels,
        data: this.notifyData(r, a), dedupeKey: `cmw:${wf.id}:${e.id}:${stepId}` }), m);
      await this.store.log(m, e.id, stepId, 'notify', 'queued', { templateKey: a.templateKey, channels: a.channels });
      return;
    }
    await this.events.publish(new MarketingGrantCouponRequested(e.userId, { userId: e.userId, couponId: a.couponId }), m);
    await this.store.log(m, e.id, stepId, 'grant_coupon', 'queued', { couponId: a.couponId });
  }

  private notifyData({ wf, e }: Run, a: Extract<WorkflowAction, { kind: 'notify' }>): Record<string, unknown> {
    return { ...(a.data ?? {}), workflow_id: wf.id, ...(e.triggerEvent ? { event: e.triggerEvent.attributes } : {}) };
  }

  /** Guests (spec §10): push to the device only, capped per device; everything that needs a customer is skipped. */
  private async guestAction(r: Run, stepId: string, a: WorkflowAction): Promise<void> {
    const { m, wf, e } = r;
    if (a.kind !== 'notify') { await this.store.log(m, e.id, stepId, 'grant_coupon', 'skipped', { reason: 'guest_no_user' }); return; }
    const device = e.deviceId ? await this.store.devicePush(m, e.deviceId) : null;
    if (!a.channels.includes('push') || !device?.pushSubscriptionId) {
      await this.store.log(m, e.id, stepId, 'notify', 'skipped', { reason: 'guest_channel', templateKey: a.templateKey });
      return;
    }
    if (!e.isTest && (await this.store.guestPushesLast24h(m, e.deviceId!)) >= GUEST_PUSH_DAILY_CAP) {
      await this.store.log(m, e.id, stepId, 'notify', 'skipped', { reason: 'guest_cap', templateKey: a.templateKey });
      return;
    }
    await this.events.publish(new MarketingNotifyRequested(e.deviceId!, { userId: null, templateKey: a.templateKey, channels: ['push'],
      target: { kind: 'device', subscriptionId: device.pushSubscriptionId, platform: device.platform },
      data: this.notifyData(r, a), dedupeKey: `cmw:${wf.id}:${e.id}:${stepId}` }), m);
    await this.store.logGuestPush(m, e.deviceId!);
    await this.store.log(m, e.id, stepId, 'notify', 'queued', { templateKey: a.templateKey, channels: ['push'], guest: true });
  }
```

- `webhook()` vars:

```ts
    const device = e.deviceId ? await this.store.devicePush(m, e.deviceId) : null;
    const vars = { ...webhookVars(e.userId ? await this.store.customerData(m, e.userId) : null,
      { userId: e.userId ?? '', workflowId: wf.id, workflowName: wf.name, enrollmentId: e.id, stepId: step.id }),
      ...eventVars(e.triggerEvent, e.deviceId && device ? { id: e.deviceId, platform: device.platform } : null) };
```

- [ ] **Step 5: Run the tests**

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow-engine workflow.store`
Expected: PASS (old engine tests unchanged; DB spec skipped without a DB — run it if one exists).

- [ ] **Step 6: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-workflow
git commit -m "feat(marketing-workflow): guest enrollments, wait for event, event condition, event goals in the engine"
```

### Task 11: Event triggers, queue, analytics, test run

**Files:**
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/application/workflow-triggers.service.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/application/workflow-queue.ts`, `workflow.processor.ts`, `workflow-trigger.listener.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/application/workflow-analytics.service.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/presentation/marketing-workflow.controller.ts`
- Modify: `apps/commerce-platform/src/modules/integration/marketing-workflow/infrastructure/workflow.store.ts` (`eventsByIds`)
- Test: `.../application/workflow-triggers.spec.ts`

**Interfaces:**
- Consumes: `EventsStore.byIds` is not used here (the workflow store reads events itself to keep the fake-store test pattern); `matchesFilters`, `EventRuleService.typesOf`, engine `enroll` / `resumeFromEvent`, store `waitingFor` / `eventGoalCandidates` / `markConvertedAt` / `devicePush`.
- Produces: `WorkflowTriggers.handleEvents(eventIds: string[], now?: Date): Promise<void>`, `WorkflowQueue.events(eventIds: string[])`, job `events`, listener `@OnEvent('marketing-trigger.events')`.

- [ ] **Step 1: Write the failing tests** — in `workflow-triggers.spec.ts`, `setup()` gains the event store calls and a rule service (constructor `new WorkflowTriggers(store, engine, rules)`):

```ts
    eventsByIds: jest.fn(async () => events),
    waitingFor: jest.fn(async () => waits),
    eventGoalCandidates: jest.fn(async () => goals),
    markConvertedAt: jest.fn(async () => undefined),
    devicePush: jest.fn(async () => device),
```

with extra `setup` parameters `events: object[] = [], waits: object[] = [], goals: object[] = [], device: object | null = null`, `const engine = { enroll: jest.fn(async (..._a: unknown[]) => 'e1'), resumeFromEvent: jest.fn(async () => undefined) };`, `const rules = { typesOf: jest.fn(async () => ({ order_id: 'string', price: 'number' })) };`.

```ts
  describe('event triggers (spec §7)', () => {
    const D = 'd'.repeat(32);
    const ev = (over: object = {}) => ({ eventId: 'ev-1', deviceId: D, name: 'add_to_cart', attributes: { price: 600, order_id: 'O1' },
      occurredAt: '2026-10-10T06:10:00.000Z', attributedUserId: U, attribution: 'device_link', actorKind: 'customer', ...over });
    const eventWf = (cfg: object = {}) => wf('event', { eventName: 'add_to_cart', filters: [{ key: 'price', op: 'gte', value: 500 }], includeGuests: false, ...cfg });

    it('enrolls once per event id with the trigger event, only for matching recent events after activation', async () => {
      const s = setup([eventWf()], {}, false, [ev()]);
      await s.t.handleEvents(['ev-1'], T);
      expect(s.engine.enroll).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-event' }), { userId: U, deviceId: null }, 'ev-1',
        { triggerEvent: { eventId: 'ev-1', name: 'add_to_cart', attributes: { price: 600, order_id: 'O1' } } });
      for (const over of [{ attributes: { price: 100 } }, { occurredAt: '2026-10-10T05:00:00.000Z' }, { occurredAt: '2026-10-10T02:59:00.000Z' }, { name: 'view_item' }]) {
        const n = setup([eventWf()], {}, false, [ev(over)]);
        await n.t.handleEvents(['ev-1'], T);
        expect(n.engine.enroll).not.toHaveBeenCalled();
      }
    });

    it('skips staff and no-consent events entirely; guests only when the workflow includes guests and the device takes push', async () => {
      for (const over of [{ attribution: 'staff', attributedUserId: null }, { attribution: 'no_consent', attributedUserId: null }]) {
        const s = setup([eventWf({ includeGuests: true })], {}, false, [ev(over)], [{ id: 'e9', waitingFor: { stepId: 's', eventName: 'add_to_cart', filters: [], since: '' }, triggerEvent: null }]);
        await s.t.handleEvents(['ev-1'], T);
        expect(s.engine.enroll).not.toHaveBeenCalled();
        expect(s.engine.resumeFromEvent).not.toHaveBeenCalled();
      }
      const guest = ev({ attributedUserId: null, attribution: null });
      const noGuests = setup([eventWf()], {}, false, [guest], [], [], { pushSubscriptionId: 'x', platform: 'web' });
      await noGuests.t.handleEvents(['ev-1'], T);
      expect(noGuests.engine.enroll).not.toHaveBeenCalled();
      const noPush = setup([eventWf({ includeGuests: true })], {}, false, [guest], [], [], { pushSubscriptionId: null, platform: 'web' });
      await noPush.t.handleEvents(['ev-1'], T);
      expect(noPush.engine.enroll).not.toHaveBeenCalled();
      const ok = setup([eventWf({ includeGuests: true })], {}, false, [guest], [], [], { pushSubscriptionId: 'x', platform: 'web' });
      await ok.t.handleEvents(['ev-1'], T);
      expect(ok.engine.enroll).toHaveBeenCalledWith(expect.anything(), { userId: null, deviceId: D }, 'ev-1', expect.anything());
    });

    it('wakes waiting enrollments whose filters match (fromTrigger) and marks event-goal conversions', async () => {
      const waits = [
        { id: 'w1', waitingFor: { stepId: 's1', eventName: 'add_to_cart', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], since: '' }, triggerEvent: { eventId: 'x', name: 'begin_checkout', attributes: { order_id: 'O1' } } },
        { id: 'w2', waitingFor: { stepId: 's1', eventName: 'add_to_cart', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], since: '' }, triggerEvent: { eventId: 'y', name: 'begin_checkout', attributes: { order_id: 'O2' } } },
      ];
      const goals = [{ id: 'g1', goal: { kind: 'event', eventName: 'add_to_cart', filters: [] }, triggerEvent: null }];
      const s = setup([], {}, false, [ev()], waits, goals);
      await s.t.handleEvents(['ev-1'], T);
      expect(s.engine.resumeFromEvent).toHaveBeenCalledTimes(1);
      expect(s.engine.resumeFromEvent).toHaveBeenCalledWith('w1', 's1', 'ev-1');
      expect(s.store.markConvertedAt).toHaveBeenCalledWith('g1', new Date('2026-10-10T06:10:00.000Z'));
    });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow-triggers`
Expected: FAIL — `handleEvents is not a function`.

- [ ] **Step 3: Implement**

Store (`workflow.store.ts`):

```ts
  /** Events to act on (spec §7). Bounded to the last 8 days so partition pruning applies (ingest refuses older events). */
  async eventsByIds(ids: string[]): Promise<{ eventId: string; deviceId: string; name: string; attributes: Record<string, unknown>; occurredAt: string;
    attributedUserId: string | null; attribution: string | null; actorKind: string | null }[]> {
    if (!ids.length) return [];
    const rows = await this.db.query(`SELECT event_id, device_id, name, attributes, occurred_at, attributed_user_id, attribution, actor_kind FROM marketing_events
      WHERE event_id = ANY($1::uuid[]) AND occurred_at >= now() - interval '8 days' ORDER BY occurred_at`, [ids]);
    return rows.map((r: Row) => ({ eventId: r.event_id as string, deviceId: r.device_id as string, name: r.name as string,
      attributes: (r.attributes as Record<string, unknown>) ?? {}, occurredAt: new Date(r.occurred_at as string).toISOString(),
      attributedUserId: (r.attributed_user_id as string | null) ?? null, attribution: (r.attribution as string | null) ?? null, actorKind: (r.actor_kind as string | null) ?? null }));
  }
```

`workflow-triggers.service.ts` — constructor `(store, engine, private readonly rules: EventRuleService)`; add:

```ts
  /**
   * New / newly attributed events (spec §7–9), in order: wake waits, mark event-goal conversions, then enroll. Staff and
   * no-consent events do nothing. Guests: only workflows with includeGuests, only devices that accept push (spec §5.1).
   */
  async handleEvents(eventIds: string[], now = new Date()): Promise<void> {
    const events = await this.store.eventsByIds(eventIds);
    if (!events.length) return;
    const workflows = await this.store.activeWorkflows(['event']);
    const recent = now.getTime() - TRIGGER_RECENT_MINUTES * 60_000;
    for (const ev of events) {
      if (ev.attribution === 'staff' || ev.attribution === 'no_consent' || ev.actorKind === 'staff') continue;
      const who = ev.attributedUserId ? { userId: ev.attributedUserId, deviceId: null } : { userId: null, deviceId: ev.deviceId };
      const at = new Date(ev.occurredAt);
      const types = await this.rules.typesOf(ev.name);
      for (const w of await this.store.waitingFor(who, ev.name, at)) {
        if (matchesFilters(ev.attributes, w.waitingFor.filters ?? [], types, w.triggerEvent?.attributes ?? null, now)) await this.engine.resumeFromEvent(w.id, w.waitingFor.stepId, ev.eventId);
      }
      for (const g of await this.store.eventGoalCandidates(who, ev.name, at)) {
        if (matchesFilters(ev.attributes, g.goal.filters ?? [], types, g.triggerEvent?.attributes ?? null, now)) await this.store.markConvertedAt(g.id, at);
      }
      if (at.getTime() < recent) continue;
      let guestOk: boolean | null = null;
      for (const wf of workflows) {
        const cfg = wf.triggerConfig as EventTriggerConfig;
        if (!wf.activatedAt || at < wf.activatedAt || cfg.eventName !== ev.name) continue;
        if (!who.userId) {
          if (!cfg.includeGuests) continue;
          guestOk ??= !!(await this.store.devicePush(this.store.manager, ev.deviceId))?.pushSubscriptionId;
          if (!guestOk) continue;
        }
        if (!matchesFilters(ev.attributes, cfg.filters ?? [], types, null, now)) continue;
        await this.engine.enroll(wf, who, ev.eventId, { triggerEvent: { eventId: ev.eventId, name: ev.name, attributes: ev.attributes } });
      }
    }
  }
```

(`store.manager`: add `get manager(): EntityManager { return this.db.manager; }` to `WorkflowStore`; in the spec fake add `manager: {}`.)

`workflow-queue.ts`:

```ts
  events(eventIds: string[]): void {
    this.jobs.add('events', { eventIds }, { ...KEEP, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
      .catch((e) => this.logger.warn(`enqueue events ${eventIds.length}: ${e}`));
  }
```

`workflow.processor.ts`: job data type gains `eventIds?: string[]`; add `if (job.name === 'events' && job.data.eventIds?.length) return this.triggers.handleEvents(job.data.eventIds);`.

`workflow-trigger.listener.ts`: `@OnEvent('marketing-trigger.events') events(p: { eventIds: string[] }) { this.queue.events(p.eventIds); }`.

`workflow-analytics.service.ts`: the counts query adds `count(*) FILTER (WHERE device_id IS NOT NULL)::int AS guests, count(*) FILTER (WHERE device_id IS NOT NULL AND user_id IS NOT NULL)::int AS merged`; `counts` returns `enrolledGuests: c.guests, mergedToUser: c.merged`; enrollment rows add `deviceId: r.device_id ?? null`.

`marketing-workflow.controller.ts` test run:

```ts
    const trigger = row.triggerType === 'event'
      ? { eventId: `test:${Date.now()}`, name: (row.triggerConfig as { eventName: string }).eventName, attributes: x.eventAttributes ?? {} } : null;
    return { enrollmentId: await this.engine.enroll(row, x.userId, `test:${Date.now()}`, { test: true, skipWaits: x.skipWaits, triggerEvent: trigger }) };
```

- [ ] **Step 4: Run the module tests and the type check**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow marketing-events josh-events`
Expected: PASS.
Run: `npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json`
Expected: 0 errors (the Task 1 leftovers are gone).

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-workflow
git commit -m "feat(marketing-workflow): event triggers, wake waits, event-goal conversions, guest analytics, test-run attributes"
```

---

## Part B — commerce-admin

Run admin tests with `npx vitest run <spec path> --config apps/commerce-admin/vite.config.mts` and type-check with `npx tsc --noEmit -p apps/commerce-admin/tsconfig.app.json`. Every new Thai string goes through `__uiText(...)` and gets a `{th, en}` entry in `libs/ui/src/locales/ui-messages.json` in the same task.

### Task 12: API client, Events page, routes and navigation

**Files:**
- Modify: `apps/commerce-admin/src/lib/api.ts`
- Create: `apps/commerce-admin/src/app/pages/marketing-events/EventsPage.tsx`, `apps/commerce-admin/src/app/pages/marketing-events/index.tsx`
- Modify: `apps/commerce-admin/src/app/app.tsx`, `apps/commerce-admin/src/app/navigation.ts`, `libs/ui/src/locales/ui-messages.json`
- Test: `apps/commerce-admin/src/app/navigation.spec.ts` (existing — must still pass)

**Interfaces:**
- Consumes: routes from Task 7.
- Produces: `eventsApi`, `dynamicSegmentsApi` (exact shapes below); routes `/marketing/events`, `/marketing/dynamic-segments`, `/marketing/dynamic-segments/:id`.

- [ ] **Step 1: Add the API client** (after `flowsApi` in `lib/api.ts`; add the new types to the `@cp/marketing-workflow` import):

```ts
// ---- Behaviour events + dynamic segments (spec 2026-10-10-marketing-event-layer) ----
const qs = (q: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();
export const eventsApi = {
  definitions: () => api.get<{ definitions: EventDefinition[]; coverage: EventCoverage[] }>('/marketing/events/definitions'),
  createDefinition: (d: EventDefinitionInput) => api.post<EventDefinition>('/marketing/events/definitions', d),
  updateDefinition: (name: string, d: EventDefinitionInput) => api.put<EventDefinition>(`/marketing/events/definitions/${encodeURIComponent(name)}`, d),
  archive: (name: string) => api.post<EventDefinition>(`/marketing/events/definitions/${encodeURIComponent(name)}/archive`, {}),
  list: (q: { deviceId?: string; userId?: string; name?: string; page: number }) => api.get<{ rows: MarketingEventRow[]; total: number }>(`/marketing/events?${qs(q)}`),
  daily: (from: string, to: string) => api.get<EventDailyRow[]>(`/marketing/events/daily?${qs({ from, to })}`),
};
export const dynamicSegmentsApi = {
  list: () => api.get<DynamicSegment[]>('/marketing/dynamic-segments'),
  get: (id: string) => api.get<DynamicSegment>(`/marketing/dynamic-segments/${id}`),
  create: (s: DynamicSegmentInput) => api.post<DynamicSegment>('/marketing/dynamic-segments', s),
  update: (id: string, s: DynamicSegmentInput) => api.put<DynamicSegment>(`/marketing/dynamic-segments/${id}`, s),
  remove: (id: string) => api.del<void>(`/marketing/dynamic-segments/${id}`),
  preview: (rule: EventRule) => api.post<{ count: number | null; issues: string[] }>('/marketing/dynamic-segments/preview', { rule }),
};
```

and change `flowsApi.testRun` to `testRun: (id: string, userId: string, skipWaits: boolean, eventAttributes?: Record<string, unknown>) => api.post<{ enrollmentId: string | null }>(\`/marketing/flows/${id}/test-run\`, { userId, skipWaits, ...(eventAttributes ? { eventAttributes } : {}) }),`.

- [ ] **Step 2: Write the Events page** `pages/marketing-events/EventsPage.tsx`:

```tsx
// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { Alert, Button, Checkbox, Empty, Field, Input, Loading, Page, PageHeader, Panel, PanelHead, Segmented, Select, Table, TBody, TD, TH, THead, TR,
  uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { EventAttributeDef, EventAttributeType, EventDefinition, EventDefinitionInput } from '@cp/marketing-workflow';
import { eventsApi } from '../../../lib/api';
import { useAsync } from '../../hooks';

const errorText = (e: unknown) => {
  const d = (e as { details?: { issues?: string[]; users?: string[]; message?: string } })?.details;
  return [d?.message, ...(d?.issues ?? []), ...(d?.users ?? [])].filter(Boolean).join(' · ') || (e instanceof Error ? e.message : String(e));
};
const TYPES: EventAttributeType[] = ['string', 'number', 'boolean', 'date'];
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** /marketing/events: catalog (what ingest accepts), recent events, daily totals (spec §14). */
export function EventsPage() {
  __useUiLocale();
  const [tab, setTab] = useState<'catalog' | 'recent' | 'daily'>('catalog');
  return (
    <Page>
      <PageHeader title={__uiText('Event ลูกค้า')} />
      <Alert tone="info">{__uiText('ห้ามประกาศ attribute ที่เป็นข้อมูลส่วนบุคคล (อีเมล เบอร์โทร ชื่อ ที่อยู่) — ระบบจะปฏิเสธ')}</Alert>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'catalog', label: __uiText('รายการ event') },
        { value: 'recent', label: __uiText('Event ล่าสุด') }, { value: 'daily', label: __uiText('รายวัน') }]} />
      <div className="mt-3">{tab === 'catalog' ? <Catalog /> : tab === 'recent' ? <Recent /> : <Daily />}</div>
    </Page>
  );
}

function Catalog() {
  __useUiLocale();
  const data = useAsync(() => eventsApi.definitions(), []);
  const [editing, setEditing] = useState<EventDefinition | 'new' | null>(null);
  if (data.loading && !data.data) return <Loading />;
  const coverage = data.data?.coverage ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-on-surface-variant">
        {coverage.length ? coverage.map((c) => `${c.platform}: ${__uiText('เริ่มเก็บ')} ${new Date(c.collectingSince).toLocaleDateString()}`).join(' · ')
          : __uiText('ยังไม่มี event เข้ามา')}
      </p>
      {editing ? <DefinitionEditor value={editing === 'new' ? null : editing} onDone={() => { setEditing(null); data.reload(); }} /> : (
        <Panel>
          <PanelHead title={__uiText('รายการ event')} actions={<Button size="sm" icon="add" onClick={() => setEditing('new')}>{__uiText('สร้าง event')}</Button>} />
          <Table>
            <THead><TH>{__uiText('ชื่อ')}</TH><TH>{__uiText('แสดงเป็น')}</TH><TH>{__uiText('Attribute')}</TH><TH>{__uiText('หลักฐาน')}</TH><TH>{__uiText('สถานะ')}</TH><TH kind="actions" /></THead>
            <TBody>{(data.data?.definitions ?? []).map((d) => (
              <TR key={d.name}>
                <TD kind="mono">{d.name}</TD><TD>{d.label}</TD>
                <TD>{d.attributes.filter((a) => !a.archived).map((a) => `${a.key}:${a.type}`).join(', ') || '—'}</TD>
                <TD>{d.evidence === 'browser' ? __uiText('จากหน้าเว็บ / แอป') : __uiText('จากเซิร์ฟเวอร์')}</TD>
                <TD>{d.status === 'active' ? __uiText('ใช้งาน') : __uiText('เก็บถาวร')}</TD>
                <TD kind="actions"><Button size="sm" variant="ghost" onClick={() => setEditing(d)}>{__uiText('แก้ไข')}</Button></TD>
              </TR>
            ))}</TBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

function DefinitionEditor({ value, onDone }: { value: EventDefinition | null; onDone: () => void }) {
  __useUiLocale();
  const [d, setD] = useState<EventDefinitionInput>(value ?? { name: '', label: '', description: null, evidence: 'browser', attributes: [] });
  const [error, setError] = useState<string | null>(null);
  const known = new Set((value?.attributes ?? []).map((a) => a.key));
  const setAttr = (i: number, patch: Partial<EventAttributeDef>) => setD({ ...d, attributes: d.attributes.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const save = async () => {
    setError(null);
    try { if (value) await eventsApi.updateDefinition(value.name, d); else await eventsApi.createDefinition(d); onDone(); }
    catch (e) { setError(errorText(e)); }
  };
  const archive = async () => { setError(null); try { await eventsApi.archive(value!.name); onDone(); } catch (e) { setError(errorText(e)); } };
  return (
    <Panel>
      <PanelHead title={value ? value.name : __uiText('สร้าง event')} />
      <div className="space-y-3 p-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={__uiText('ชื่อ (a-z 0-9 _)')}><Input value={d.name} disabled={!!value} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label={__uiText('แสดงเป็น')}><Input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></Field>
        </div>
        <Field label={__uiText('หลักฐาน')}>
          <Select value={d.evidence} onChange={(e) => setD({ ...d, evidence: e.target.value as EventDefinitionInput['evidence'] })}>
            <option value="browser">{__uiText('จากหน้าเว็บ / แอป (ผู้ใช้ปลอมได้ ไม่ใช่หลักฐานการซื้อ)')}</option>
            <option value="server">{__uiText('จากเซิร์ฟเวอร์')}</option>
          </Select>
        </Field>
        <Field label={__uiText('Attribute')}>
          <div className="space-y-2">
            {d.attributes.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_1fr_auto] items-center gap-2">
                <Input value={a.key} disabled={known.has(a.key)} placeholder="item_id" onChange={(e) => setAttr(i, { key: e.target.value })} />
                <Select value={a.type} disabled={known.has(a.key)} onChange={(e) => setAttr(i, { type: e.target.value as EventAttributeType })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Input value={a.label} placeholder={__uiText('แสดงเป็น')} onChange={(e) => setAttr(i, { label: e.target.value })} />
                {known.has(a.key)
                  ? <Checkbox checked={!!a.archived} onChange={(e) => setAttr(i, { archived: e.target.checked })} label={__uiText('เก็บถาวร')} />
                  : <Button size="sm" variant="ghost" icon="close" onClick={() => setD({ ...d, attributes: d.attributes.filter((_, j) => j !== i) })}>{__uiText('ลบ')}</Button>}
              </div>
            ))}
            <Button size="sm" icon="add" onClick={() => setD({ ...d, attributes: [...d.attributes, { key: '', type: 'string', label: '' }] })}>{__uiText('เพิ่ม attribute')}</Button>
          </div>
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" onClick={save}>{__uiText('บันทึก')}</Button>
          <Button onClick={onDone}>{__uiText('ยกเลิก')}</Button>
          {value?.status === 'active' && <Button variant="danger-ghost" onClick={archive}>{__uiText('เก็บถาวร event นี้')}</Button>}
        </div>
      </div>
    </Panel>
  );
}

function Recent() {
  __useUiLocale();
  const [q, setQ] = useState({ deviceId: '', userId: '', name: '', page: 1 });
  const [applied, setApplied] = useState(q);
  const list = useAsync(() => eventsApi.list(applied), [applied]);
  return (
    <Panel>
      <div className="flex flex-wrap items-end gap-2 p-4">
        <Field label={__uiText('Device')}><Input value={q.deviceId} onChange={(e) => setQ({ ...q, deviceId: e.target.value.trim() })} /></Field>
        <Field label={__uiText('User')}><Input value={q.userId} onChange={(e) => setQ({ ...q, userId: e.target.value.trim() })} /></Field>
        <Field label={__uiText('Event')}><Input value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value.trim() })} /></Field>
        <Button onClick={() => setApplied({ ...q, page: 1 })}>{__uiText('ค้นหา')}</Button>
      </div>
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {list.loading && !list.data ? <Loading /> : list.data?.rows.length ? (
        <Table>
          <THead><TH kind="time">{__uiText('เวลา')}</TH><TH>{__uiText('Event')}</TH><TH>{__uiText('Device')}</TH><TH>{__uiText('User')}</TH><TH>{__uiText('ระบุตัวจาก')}</TH><TH>{__uiText('Attribute')}</TH></THead>
          <TBody>{list.data.rows.map((r) => (
            <TR key={r.eventId}>
              <TD kind="time">{new Date(r.occurredAt).toLocaleString()}</TD><TD kind="mono">{r.name}</TD>
              <TD kind="mono">{r.deviceId.slice(0, 10)} · {r.platform}</TD><TD kind="mono">{r.attributedUserId?.slice(0, 8) ?? '—'}</TD>
              <TD>{r.attribution ?? __uiText('guest')}</TD><TD kind="mono">{JSON.stringify(r.attributes)}</TD>
            </TR>
          ))}</TBody>
        </Table>
      ) : <Empty>{__uiText('ไม่พบ event')}</Empty>}
      {(list.data?.total ?? 0) > 50 && (
        <div className="flex justify-end gap-2 p-3">
          <Button size="sm" disabled={applied.page === 1} onClick={() => setApplied({ ...applied, page: applied.page - 1 })}>{__uiText('ก่อนหน้า')}</Button>
          <Button size="sm" disabled={applied.page * 50 >= (list.data?.total ?? 0)} onClick={() => setApplied({ ...applied, page: applied.page + 1 })}>{__uiText('ถัดไป')}</Button>
        </div>
      )}
    </Panel>
  );
}

function Daily() {
  __useUiLocale();
  const [range, setRange] = useState({ from: day(-14), to: day(-1) });
  const rows = useAsync(() => eventsApi.daily(range.from, range.to), [range]);
  return (
    <Panel>
      <div className="flex items-end gap-2 p-4">
        <Field label={__uiText('ตั้งแต่')}><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label={__uiText('ถึง')}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div>
      {rows.loading && !rows.data ? <Loading /> : rows.data?.length ? (
        <Table>
          <THead><TH>{__uiText('วันที่')}</TH><TH>{__uiText('Event')}</TH><TH>{__uiText('แพลตฟอร์ม')}</TH><TH kind="num">{__uiText('จำนวน')}</TH><TH kind="num">{__uiText('ลูกค้า')}</TH><TH kind="num">{__uiText('อุปกรณ์')}</TH></THead>
          <TBody>{rows.data.map((r) => (
            <TR key={`${r.date}:${r.name}:${r.platform}`}><TD>{r.date}</TD><TD kind="mono">{r.name}</TD><TD>{r.platform}</TD>
              <TD kind="num">{r.events}</TD><TD kind="num">{r.users}</TD><TD kind="num">{r.devices}</TD></TR>
          ))}</TBody>
        </Table>
      ) : <Empty>{__uiText('ยังไม่มีสรุปรายวันในช่วงนี้ (สรุปทุกคืนตี 3)')}</Empty>}
    </Panel>
  );
}
```

`pages/marketing-events/index.tsx`:

```tsx
import { TaskPageFrame } from '@cp/ui';
import { DynamicSegmentsPage } from './DynamicSegmentsPage';
import { EventsPage } from './EventsPage';

export function MarketingEvents() { return <TaskPageFrame><EventsPage /></TaskPageFrame>; }
export function DynamicSegments() { return <TaskPageFrame><DynamicSegmentsPage /></TaskPageFrame>; }
```

(Task 13 creates `DynamicSegmentsPage`; until then export only `MarketingEvents` and add the second export in Task 13.)

- [ ] **Step 3: Routes and navigation**
  - `app.tsx`: `import { MarketingEvents } from './pages/marketing-events';` and next to the `/marketing/flows` routes: `<Route path="/marketing/events" element={<MarketingEvents />} />`.
  - `navigation.ts` marketing list, after `ข้อความอัตโนมัติ`: `{ to: '/marketing/events', label: 'Event ลูกค้า', more: true, description: 'event ที่เว็บและแอปส่งมา และรายการ event ที่ระบบรับ' },`.
  - `ui-messages.json`: add `{th, en}` for every new string in this task (e.g. `"Event ลูกค้า": { "th": "Event ลูกค้า", "en": "Customer events" }`).

- [ ] **Step 4: Check**

Run: `npx vitest run apps/commerce-admin/src/app/navigation.spec.ts --config apps/commerce-admin/vite.config.mts` — expected PASS.
Run: `npx tsc --noEmit -p apps/commerce-admin/tsconfig.app.json` — expected 0 errors in the new files (errors in `pages/marketing-workflow/*` from the widened `WorkflowStep` union are fixed in Task 14; record them).

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-admin/src/lib/api.ts apps/commerce-admin/src/app/pages/marketing-events apps/commerce-admin/src/app/app.tsx apps/commerce-admin/src/app/navigation.ts libs/ui/src/locales/ui-messages.json
git commit -m "feat(admin): event catalog, recent events and daily totals page"
```

### Task 13: Filter editor, event rule builder, dynamic segments page

**Files:**
- Create: `apps/commerce-admin/src/app/pages/marketing-events/rule-helpers.ts` (+ `rule-helpers.spec.ts`)
- Create: `apps/commerce-admin/src/app/pages/marketing-events/FilterEditor.tsx`
- Create: `apps/commerce-admin/src/app/pages/marketing-events/EventRuleBuilder.tsx`
- Create: `apps/commerce-admin/src/app/pages/marketing-events/DynamicSegmentsPage.tsx`
- Modify: `apps/commerce-admin/src/app/pages/marketing-events/index.tsx`, `apps/commerce-admin/src/app/app.tsx`, `apps/commerce-admin/src/app/navigation.ts`, `libs/ui/src/locales/ui-messages.json`

**Interfaces:**
- Produces: `OPS_BY_TYPE`, `defaultFilter(def: EventDefinition): EventFilter | null`, `newEventLeaf(def: EventDefinition | undefined): EventRule`, `describeRule(rule: EventRule, names: Map<string, string>): string`, `<FilterEditor filters types triggerTypes? onChange />`, `<EventRuleBuilder rule definitions segments? allowSegments onChange />` (used by Task 14).

- [ ] **Step 1: Write the failing test** `rule-helpers.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EventDefinition } from '@cp/marketing-workflow';
import { defaultFilter, describeRule, newEventLeaf } from './rule-helpers';

const cart: EventDefinition = { name: 'add_to_cart', label: 'ใส่ตะกร้า', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'old', type: 'string', label: '', archived: true }, { key: 'price', type: 'number', label: 'ราคา' }] };

describe('rule helpers', () => {
  it('starts filters on the first live attribute with a value of its type', () => {
    expect(defaultFilter(cart)).toEqual({ key: 'price', op: 'gte', value: 0 });
    expect(defaultFilter({ ...cart, attributes: [] })).toBeNull();
  });
  it('a new leaf counts the event at least once in 7 days', () => {
    expect(newEventLeaf(cart)).toEqual({ kind: 'event', name: 'add_to_cart', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] });
  });
  it('describes rules in one line', () => {
    const names = new Map([['add_to_cart', 'ใส่ตะกร้า']]);
    expect(describeRule({ op: 'OR', children: [newEventLeaf(cart), { kind: 'event', name: 'add_to_cart', measure: { sum: 'price' }, op: 'gte', value: 500, window: { lastDays: 30 }, filters: [] }] }, names))
      .toBe('(ใส่ตะกร้า ≥ 1 ครั้ง / 7 วัน OR ใส่ตะกร้า ผลรวม price ≥ 500 / 30 วัน)');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/commerce-admin/src/app/pages/marketing-events/rule-helpers.spec.ts --config apps/commerce-admin/vite.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `rule-helpers.ts`:

```ts
import type { EventAttributeType, EventDefinition, EventFilter, EventRule, FilterOp } from '@cp/marketing-workflow';

/** Same table as commerce-platform marketing-events/domain/event-filter.ts. */
export const OPS_BY_TYPE: Record<EventAttributeType, FilterOp[]> = {
  string: ['eq', 'neq', 'contains', 'in'], number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], boolean: ['eq'],
  date: ['before', 'after', 'within_last_days', 'within_next_days'],
};
export const OP_LABEL: Record<FilterOp, string> = {
  eq: '=', neq: '≠', contains: 'มีคำว่า', in: 'เป็นหนึ่งใน', gt: '>', gte: '≥', lt: '<', lte: '≤', before: 'ก่อน', after: 'หลัง',
  within_last_days: 'ภายใน N วันที่ผ่านมา', within_next_days: 'ภายใน N วันข้างหน้า',
};
const DEFAULT_VALUE: Record<EventAttributeType, EventFilter['value']> = { string: '', number: 0, boolean: true, date: new Date().toISOString().slice(0, 10) };

export const liveAttributes = (def: EventDefinition | undefined) => (def?.attributes ?? []).filter((a) => !a.archived);

export function defaultFilter(def: EventDefinition): EventFilter | null {
  const a = liveAttributes(def)[0];
  if (!a) return null;
  const op = a.type === 'number' ? 'gte' : OPS_BY_TYPE[a.type][0];
  return { key: a.key, op, value: DEFAULT_VALUE[a.type] };
}

export function newEventLeaf(def: EventDefinition | undefined): EventRule {
  return { kind: 'event', name: def?.name ?? '', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] };
}

const CMP = { gte: '≥', eq: '=', lte: '≤' } as const;
export function describeRule(rule: EventRule, names: Map<string, string>): string {
  if ('children' in rule) return `(${rule.children.map((c) => describeRule(c, names)).join(` ${rule.op} `)})`;
  if (rule.kind === 'segment') return `segment ${names.get(rule.segmentId) ?? rule.segmentId.slice(0, 8)}`;
  const what = rule.measure === 'count' ? `${CMP[rule.op]} ${rule.value} ครั้ง` : `ผลรวม ${rule.measure.sum} ${CMP[rule.op]} ${rule.value}`;
  const when = 'lastDays' in rule.window ? `${rule.window.lastDays} วัน` : `${rule.window.from.slice(0, 10)}–${rule.window.to.slice(0, 10)}`;
  return `${names.get(rule.name) ?? rule.name} ${what} / ${when}${rule.filters.length ? ` (+${rule.filters.length})` : ''}`;
}
```

`FilterEditor.tsx`:

```tsx
// ui-copy-migration: only literal UI copy and notification templates
import { Button, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { EventAttributeType, EventFilter, FilterOp } from '@cp/marketing-workflow';
import { OP_LABEL, OPS_BY_TYPE } from './rule-helpers';

type Types = Record<string, EventAttributeType>;
const FROM_TRIGGER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'before', 'after'];

/** AND list of attribute filters. `triggerTypes` given → a value may come from the event that started the workflow (spec §6). */
export function FilterEditor({ filters, types, triggerTypes, onChange }: { filters: EventFilter[]; types: Types; triggerTypes?: Types | null; onChange: (f: EventFilter[]) => void }) {
  __useUiLocale();
  const keys = Object.keys(types);
  const set = (i: number, f: EventFilter) => onChange(filters.map((x, j) => (j === i ? f : x)));
  const valueInput = (f: EventFilter, i: number) => {
    const type = types[f.key];
    if (typeof f.value === 'object' && f.value && !Array.isArray(f.value)) {
      const same = Object.entries(triggerTypes ?? {}).filter(([, t]) => t === type).map(([k]) => k);
      return <Select value={f.value.fromTrigger} onChange={(e) => set(i, { ...f, value: { fromTrigger: e.target.value } })}>{same.map((k) => <option key={k} value={k}>{k}</option>)}</Select>;
    }
    if (f.op === 'in') return <Input value={(f.value as string[]).join(',')} placeholder="A,B" onChange={(e) => set(i, { ...f, value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />;
    if (type === 'boolean') return <Select value={String(f.value)} onChange={(e) => set(i, { ...f, value: e.target.value === 'true' })}><option value="true">true</option><option value="false">false</option></Select>;
    if (type === 'number' || f.op === 'within_last_days' || f.op === 'within_next_days')
      return <Input type="number" value={Number(f.value)} onChange={(e) => set(i, { ...f, value: Number(e.target.value) })} />;
    if (type === 'date') return <Input type="date" value={String(f.value).slice(0, 10)} onChange={(e) => set(i, { ...f, value: e.target.value })} />;
    return <Input value={String(f.value)} onChange={(e) => set(i, { ...f, value: e.target.value })} />;
  };
  return (
    <div className="space-y-2">
      {filters.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1.2fr_auto] items-center gap-1">
          <Select value={f.key} onChange={(e) => { const t = types[e.target.value]; set(i, { key: e.target.value, op: OPS_BY_TYPE[t][0], value: t === 'number' ? 0 : t === 'boolean' ? true : '' }); }}>
            {keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
          <Select value={f.op} onChange={(e) => set(i, { ...f, op: e.target.value as FilterOp, value: e.target.value === 'in' ? [] : f.value })}>
            {OPS_BY_TYPE[types[f.key] ?? 'string'].map((op) => <option key={op} value={op}>{__uiText(OP_LABEL[op])}</option>)}
          </Select>
          <div className="flex items-center gap-1">
            {valueInput(f, i)}
            {triggerTypes && FROM_TRIGGER_OPS.includes(f.op) && (
              <Button size="sm" variant="ghost" title={__uiText('ใช้ค่าจาก event ที่เริ่ม workflow')}
                onClick={() => set(i, { ...f, value: typeof f.value === 'object' && !Array.isArray(f.value) ? '' : { fromTrigger: f.key } })}>⇄</Button>
            )}
          </div>
          <Button size="sm" variant="ghost" icon="close" aria-label={__uiText('ลบเงื่อนไข')} onClick={() => onChange(filters.filter((_, j) => j !== i))} />
        </div>
      ))}
      {keys.length > 0 && filters.length < 10 && (
        <Button size="sm" icon="add" onClick={() => { const t = types[keys[0]]; onChange([...filters, { key: keys[0], op: OPS_BY_TYPE[t][0], value: t === 'number' ? 0 : t === 'boolean' ? true : '' }]); }}>
          {__uiText('เพิ่มเงื่อนไข attribute')}
        </Button>
      )}
    </div>
  );
}
```

`EventRuleBuilder.tsx`:

```tsx
// ui-copy-migration: only literal UI copy and notification templates
import { Button, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegment, EventDefinition, EventRule } from '@cp/marketing-workflow';
import { FilterEditor } from './FilterEditor';
import { liveAttributes, newEventLeaf } from './rule-helpers';

type Group = Extract<EventRule, { children: EventRule[] }>;
const isGroup = (r: EventRule): r is Group => 'children' in r;

/** Recursive AND/OR builder for event rules (spec §11). Depth ≤ 4 is enforced by the server; the UI stops offering groups at depth 3. */
export function EventRuleBuilder({ rule, definitions, segments = [], allowSegments, onChange, depth = 1 }: {
  rule: EventRule; definitions: EventDefinition[]; segments?: DynamicSegment[]; allowSegments: boolean; onChange: (r: EventRule) => void; depth?: number;
}) {
  __useUiLocale();
  const active = definitions.filter((d) => d.status === 'active');
  if (isGroup(rule)) {
    const setChild = (i: number, c: EventRule) => onChange({ ...rule, children: rule.children.map((x, j) => (j === i ? c : x)) });
    return (
      <div className="space-y-2 rounded-lg border border-outline-variant p-2">
        <Select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as Group['op'] })} aria-label={__uiText('รวมเงื่อนไขแบบ')}>
          <option value="AND">{__uiText('ทุกข้อ (AND)')}</option><option value="OR">{__uiText('ข้อใดข้อหนึ่ง (OR)')}</option>
        </Select>
        {rule.children.map((c, i) => (
          <div key={i} className="flex items-start gap-1">
            <div className="min-w-0 flex-1"><EventRuleBuilder rule={c} definitions={definitions} segments={segments} allowSegments={allowSegments} depth={depth + 1} onChange={(x) => setChild(i, x)} /></div>
            <Button size="sm" variant="ghost" icon="close" aria-label={__uiText('ลบเงื่อนไข')} onClick={() => onChange({ ...rule, children: rule.children.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" icon="add" onClick={() => onChange({ ...rule, children: [...rule.children, newEventLeaf(active[0])] })}>{__uiText('เงื่อนไข event')}</Button>
          {allowSegments && segments.length > 0 && (
            <Button size="sm" icon="add" onClick={() => onChange({ ...rule, children: [...rule.children, { kind: 'segment', segmentId: segments[0].id }] })}>{__uiText('dynamic segment')}</Button>
          )}
          {depth < 3 && <Button size="sm" icon="add" onClick={() => onChange({ ...rule, children: [...rule.children, { op: 'AND', children: [newEventLeaf(active[0])] }] })}>{__uiText('กลุ่ม')}</Button>}
        </div>
      </div>
    );
  }
  if (rule.kind === 'segment') {
    return <Select value={rule.segmentId} onChange={(e) => onChange({ kind: 'segment', segmentId: e.target.value })}>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>;
  }
  const def = definitions.find((d) => d.name === rule.name);
  const types = Object.fromEntries(liveAttributes(def).map((a) => [a.key, a.type]));
  const numbers = liveAttributes(def).filter((a) => a.type === 'number');
  const windowDays = 'lastDays' in rule.window ? rule.window.lastDays : null;
  return (
    <div className="space-y-2 rounded-lg bg-surface-container-low p-2">
      <div className="grid grid-cols-2 gap-1">
        <Select value={rule.name} onChange={(e) => onChange({ ...rule, name: e.target.value, filters: [], measure: 'count' })} aria-label={__uiText('event')}>
          {active.map((d) => <option key={d.name} value={d.name}>{d.label} ({d.name})</option>)}
        </Select>
        <Select value={rule.measure === 'count' ? 'count' : rule.measure.sum} aria-label={__uiText('นับ')}
          onChange={(e) => onChange({ ...rule, measure: e.target.value === 'count' ? 'count' : { sum: e.target.value } })}>
          <option value="count">{__uiText('จำนวนครั้ง')}</option>
          {numbers.map((a) => <option key={a.key} value={a.key}>{__uiText('ผลรวมของ {0}', { 0: a.key })}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-[80px_1fr_1fr] gap-1">
        <Select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'gte' | 'eq' | 'lte' })} aria-label={__uiText('เปรียบเทียบ')}>
          <option value="gte">≥</option><option value="eq">=</option><option value="lte">≤</option>
        </Select>
        <Input type="number" value={rule.value} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} aria-label={__uiText('ค่า')} />
        <div className="flex items-center gap-1">
          <Input type="number" min={1} max={90} value={windowDays ?? 7} onChange={(e) => onChange({ ...rule, window: { lastDays: Math.trunc(Number(e.target.value) || 1) } })} aria-label={__uiText('วันล่าสุด')} />
          <span className="text-xs">{__uiText('วันล่าสุด')}</span>
        </div>
      </div>
      {Object.keys(types).length > 0 && <FilterEditor filters={rule.filters} types={types} onChange={(filters) => onChange({ ...rule, filters })} />}
    </div>
  );
}
```

`DynamicSegmentsPage.tsx`:

```tsx
// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Empty, Field, Input, Loading, Page, PageHeader, Panel, PanelHead, Table, TBody, TD, TH, THead, TR, Textarea,
  uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegmentInput, EventRule } from '@cp/marketing-workflow';
import { dynamicSegmentsApi, eventsApi } from '../../../lib/api';
import { useAsync } from '../../hooks';
import { EventRuleBuilder } from './EventRuleBuilder';
import { describeRule, newEventLeaf } from './rule-helpers';

const errorText = (e: unknown) => {
  const d = (e as { details?: { issues?: string[]; users?: string[]; message?: string } })?.details;
  return [d?.message, ...(d?.issues ?? []), ...(d?.users ?? [])].filter(Boolean).join(' · ') || (e instanceof Error ? e.message : String(e));
};

/** /marketing/dynamic-segments[/:id] — named event rules, evaluated live, for commerce workflows only (spec §11). */
export function DynamicSegmentsPage() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  return id ? <Editor id={id === 'new' ? null : id} /> : <List />;
}

function List() {
  __useUiLocale();
  const navigate = useNavigate();
  const list = useAsync(() => dynamicSegmentsApi.list(), []);
  const defs = useAsync(() => eventsApi.definitions(), []);
  const names = new Map((defs.data?.definitions ?? []).map((d) => [d.name, d.label]));
  return (
    <Page>
      <PageHeader title={__uiText('กลุ่มลูกค้าตาม event')} actions={<Button variant="primary" icon="add" onClick={() => navigate('/marketing/dynamic-segments/new')}>{__uiText('สร้างกลุ่ม')}</Button>} />
      <p className="text-sm text-on-surface-variant">{__uiText('คำนวณสดทุกครั้งที่ workflow ใช้ — ไม่ส่งไป josh ใช้ได้เฉพาะ workflow ของ commerce')}</p>
      {list.loading && !list.data ? <Loading /> : list.data?.length ? (
        <Panel><Table>
          <THead><TH>{__uiText('ชื่อ')}</TH><TH>{__uiText('เงื่อนไข')}</TH><TH>{__uiText('สถานะ')}</TH></THead>
          <TBody>{list.data.map((s) => (
            <TR key={s.id} onClick={() => navigate(`/marketing/dynamic-segments/${s.id}`)} className="cursor-pointer">
              <TD>{s.name}</TD><TD>{describeRule(s.rule, names)}</TD><TD>{s.issues.length ? __uiText('ต้องแก้ {0} จุด', { 0: s.issues.length }) : __uiText('พร้อมใช้')}</TD>
            </TR>
          ))}</TBody>
        </Table></Panel>
      ) : <Empty>{__uiText('ยังไม่มีกลุ่ม')}</Empty>}
    </Page>
  );
}

function Editor({ id }: { id: string | null }) {
  __useUiLocale();
  const navigate = useNavigate();
  const defs = useAsync(() => eventsApi.definitions(), []);
  const existing = useAsync(() => (id ? dynamicSegmentsApi.get(id) : Promise.resolve(null)), [id]);
  const [draft, setDraft] = useState<DynamicSegmentInput | null>(null);
  const [preview, setPreview] = useState<{ count: number | null; issues: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (defs.loading || existing.loading) return <Loading />;
  const definitions = defs.data?.definitions ?? [];
  const value: DynamicSegmentInput = draft ?? existing.data ?? { name: '', description: null, rule: { op: 'AND', children: [newEventLeaf(definitions.find((d) => d.status === 'active'))] } };
  const set = (patch: Partial<DynamicSegmentInput>) => { setDraft({ ...value, ...patch }); setPreview(null); };
  const save = async () => {
    setError(null);
    try { const s = id ? await dynamicSegmentsApi.update(id, value) : await dynamicSegmentsApi.create(value); setDraft(null); navigate(`/marketing/dynamic-segments/${s.id}`, { replace: true }); existing.reload(); }
    catch (e) { setError(errorText(e)); }
  };
  const remove = async () => { setError(null); try { await dynamicSegmentsApi.remove(id!); navigate('/marketing/dynamic-segments'); } catch (e) { setError(errorText(e)); } };
  const issues = preview?.issues ?? existing.data?.issues ?? [];
  return (
    <Page>
      <PageHeader back={{ to: '/marketing/dynamic-segments', label: __uiText('กลุ่มลูกค้าตาม event') }} title={value.name || __uiText('กลุ่มใหม่')}
        actions={<div className="flex gap-2">
          <Button onClick={async () => setPreview(await dynamicSegmentsApi.preview(value.rule).catch((e) => ({ count: null, issues: [errorText(e)] })))}>{__uiText('นับลูกค้าตอนนี้')}</Button>
          <Button variant="primary" onClick={save}>{__uiText('บันทึก')}</Button>
          {id && <Button variant="danger-ghost" onClick={remove}>{__uiText('ลบ')}</Button>}
        </div>} />
      {error && <Alert tone="danger">{error}</Alert>}
      {issues.length > 0 && <Alert tone="warn">{issues.join(' · ')}</Alert>}
      {preview?.count != null && <Alert tone="info">{__uiText('ตอนนี้มีลูกค้า (ที่ยินยอม) เข้าเงื่อนไข {0} คน', { 0: preview.count })}</Alert>}
      <Panel>
        <PanelHead title={__uiText('ตั้งค่า')} />
        <div className="space-y-3 p-4">
          <Field label={__uiText('ชื่อ')}><Input value={value.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={__uiText('คำอธิบาย')}><Textarea rows={2} value={value.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} /></Field>
          <Field label={__uiText('เงื่อนไข')}>
            <EventRuleBuilder rule={value.rule} definitions={definitions} allowSegments={false} onChange={(rule: EventRule) => set({ rule })} />
          </Field>
          <p className="text-xs text-on-surface-variant">{(defs.data?.coverage ?? []).map((c) => `${c.platform}: ${new Date(c.collectingSince).toLocaleDateString()}`).join(' · ')
            || __uiText('ยังไม่มี event เข้ามา')} — {__uiText('ช่วงเวลาย้อนก่อนวันที่เริ่มเก็บไม่ได้')}</p>
        </div>
      </Panel>
    </Page>
  );
}
```

Add `export function DynamicSegments()` to `index.tsx` (see Task 12), routes `<Route path="/marketing/dynamic-segments" element={<DynamicSegments />} />` and `<Route path="/marketing/dynamic-segments/:id" element={<DynamicSegments />} />`, navigation entry `{ to: '/marketing/dynamic-segments', label: 'กลุ่มลูกค้าตาม event', more: true, description: 'กลุ่มลูกค้าที่คำนวณสดจาก event สำหรับข้อความอัตโนมัติ' },`, and the ui-messages keys.

- [ ] **Step 4: Run the test and type check** — the vitest command above → PASS; `npx tsc --noEmit -p apps/commerce-admin/tsconfig.app.json` → no new errors outside `pages/marketing-workflow/*`.

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-admin/src/app/pages/marketing-events apps/commerce-admin/src/app/app.tsx apps/commerce-admin/src/app/navigation.ts libs/ui/src/locales/ui-messages.json
git commit -m "feat(admin): filter editor, event rule builder, dynamic segments page"
```

### Task 14: Workflow editor — event trigger, Wait for event, Event condition, goals, audience rules, guest switch

**Files:**
- Modify: `apps/commerce-admin/src/app/pages/marketing-workflow/palette-items.ts` (+ spec), `workflow-graph.ts` (+ spec), `StepPanel.tsx`, `FlowEditorPage.tsx`, `forms/StepForms.tsx`, `forms/TriggerForm.tsx`
- Create: `apps/commerce-admin/src/app/pages/marketing-workflow/forms/EventForms.tsx`
- Modify: `libs/ui/src/locales/ui-messages.json`

**Interfaces:**
- Consumes: `FilterEditor`, `EventRuleBuilder`, `liveAttributes`, `describeRule`, `newEventLeaf` (Task 13); `eventsApi`, `dynamicSegmentsApi`, `flowsApi.testRun(…, eventAttributes)` (Task 12).
- Produces: `StepKind` gains `'wait_event' | 'event_split'`; palette ids `event` (ENTRY), `wait_event`, `event_split` (FLOW).

- [ ] **Step 1: Write the failing tests**

`palette-items.spec.ts` — replace the list assertion and add:

```ts
  it('lists phase-1 items plus the event layer', () => {
    expect(PALETTE.flatMap((c) => c.items).map((i) => i.id)).toEqual([
      'scheduled', 'order_milestone', 'first_login', 'app_login', 'event', 'push', 'email', 'in_app', 'webhook',
      'wait', 'wait_event', 'condition', 'event_split', 'split', 'audience', 'grant_coupon']);
  });
  it('wait_event shares the wait limit; event_split shares the condition limit', () => {
    expect(disabledReason(item('wait_event'), [newStep('wait'), newStep('wait'), newStep('wait_event')], 'event', limits)).not.toBeNull();
    expect(disabledReason(item('event_split'), Array.from({ length: 5 }, () => newStep('condition')), 'event', limits)).not.toBeNull();
    expect(kindOf(newStep('wait_event'))).toBe('wait_event');
  });
```

`workflow-graph.spec.ts` — add:

```ts
  it('wait_event and event_split have two ports; removing them ends what pointed at them', () => {
    const w = fresh('wait_event'); const a = fresh('push'); const b = fresh('email');
    let g = insertAfter(empty, { stepId: TRIGGER }, w);
    g = insertAfter(g, { stepId: w.id, port: 'timeout' }, a);
    g = insertAfter(g, { stepId: w.id, port: 'matched' }, b);
    expect(targetOf(g, { stepId: w.id, port: 'timeout' })).toBe(a.id);
    expect(targetOf(g, { stepId: w.id, port: 'matched' })).toBe(b.id);
    g = removeStep(g, w.id);
    expect(g.entryStepId).toBeNull();
    const s = fresh('event_split');
    expect((s as { rule: { op: string } }).rule.op).toBe('AND');
    g = insertAfter(empty, { stepId: TRIGGER }, s);
    expect(firstFreePort(g, s.id)).toEqual({ stepId: s.id, port: 'yes' });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run apps/commerce-admin/src/app/pages/marketing-workflow --config apps/commerce-admin/vite.config.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the graph and palette**

`workflow-graph.ts`:

```ts
export type StepKind = 'audience' | 'wait' | 'condition' | 'split' | 'push' | 'email' | 'in_app' | 'webhook' | 'grant_coupon' | 'wait_event' | 'event_split';
// newStep:
    case 'wait_event': return { id: newId, type: 'wait_event', eventName: '', filters: [], timeoutHours: 24, timeoutMinutes: 0, matchedNextId: null, timeoutNextId: null };
    case 'event_split': return { id: newId, type: 'event_split', rule: { op: 'AND', children: [] }, yesNextId: null, noNextId: null };
// outPorts:
  if (step.type === 'event_split') return [{ port: 'yes', label: 'Yes', target: step.yesNextId }, { port: 'no', label: 'No', target: step.noNextId }];
  if (step.type === 'wait_event') return [{ port: 'matched', label: 'เกิดขึ้น', target: step.matchedNextId }, { port: 'timeout', label: 'หมดเวลา', target: step.timeoutNextId }];
// withTarget:
  if (step.type === 'event_split') return port === 'no' ? { ...step, noNextId: target } : { ...step, yesNextId: target };
  if (step.type === 'wait_event') return port === 'timeout' ? { ...step, timeoutNextId: target } : { ...step, matchedNextId: target };
// removeStep map:
    if (s.type === 'event_split') return { ...s, yesNextId: repoint(s.yesNextId), noNextId: repoint(s.noNextId) };
    if (s.type === 'wait_event') return { ...s, matchedNextId: repoint(s.matchedNextId), timeoutNextId: repoint(s.timeoutNextId) };
```

`palette-items.ts`: ENTRY gains `{ id: 'event', get label() { return uiText('เมื่อเกิด event'); }, icon: 'bolt', trigger: true }` after `app_login`; FLOW becomes `wait`, `{ id: 'wait_event', label 'Wait for event', icon 'pending_actions' }`, `condition`, `{ id: 'event_split', label 'Event condition', icon 'rule' }`, `split`, `audience`. `disabledReason`:

```ts
  const count = (...t: WorkflowStep['type'][]) => steps.filter((s) => t.includes(s.type)).length;
  if (item.id === 'audience' && count('audience') >= limits.maxAudienceSteps) return uiText('มี Audience filter ได้ 1 อัน');
  if ((item.id === 'wait' || item.id === 'wait_event') && count('wait', 'wait_event') >= limits.maxWaitSteps) return uiText('Time Delay ครบ {0} อันแล้ว', { 0: limits.maxWaitSteps });
  if ((item.id === 'condition' || item.id === 'event_split') && count('condition', 'event_split') >= limits.maxConditionSteps) return uiText('Condition ครบ {0} อันแล้ว', { 0: limits.maxConditionSteps });
```

Check `FlowCanvas.tsx` `SINGLE_EXIT`: it must not contain `wait_event` / `event_split` (two ports show their labels).

- [ ] **Step 4: Implement the forms** `forms/EventForms.tsx`:

```tsx
// ui-copy-migration: only literal UI copy and notification templates
import { Checkbox, Field, Hint, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegment, EventDefinition, EventTriggerConfig, ExitGoal, WorkflowInput, WorkflowStep } from '@cp/marketing-workflow';
import { EventRuleBuilder } from '../../marketing-events/EventRuleBuilder';
import { FilterEditor } from '../../marketing-events/FilterEditor';
import { liveAttributes } from '../../marketing-events/rule-helpers';

type Of<T extends WorkflowStep['type']> = Extract<WorkflowStep, { type: T }>;
const typesOf = (d: EventDefinition | undefined) => Object.fromEntries(liveAttributes(d).map((a) => [a.key, a.type]));
const pick = (defs: EventDefinition[], name: string) => defs.find((d) => d.name === name);

function EventSelect({ value, definitions, onChange }: { value: string; definitions: EventDefinition[]; onChange: (name: string) => void }) {
  __useUiLocale();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{__uiText('เลือก event')}</option>
      {definitions.filter((d) => d.status === 'active' || d.name === value).map((d) => <option key={d.name} value={d.name}>{d.label} ({d.name})</option>)}
    </Select>
  );
}

/** Entry = "เมื่อเกิด event": event, attribute filters, include guests (spec §7, §10). */
export function EventTriggerFields({ config, definitions, onChange }: { config: EventTriggerConfig; definitions: EventDefinition[]; onChange: (c: EventTriggerConfig) => void }) {
  __useUiLocale();
  const def = pick(definitions, config.eventName);
  return (
    <div className="space-y-3">
      <Field label={__uiText('Event')}><EventSelect value={config.eventName} definitions={definitions} onChange={(eventName) => onChange({ ...config, eventName, filters: [] })} /></Field>
      {def?.evidence === 'browser' && <Hint>{__uiText('event จากหน้าเว็บ / แอป ผู้ใช้ปลอมได้ — ถ้าแจกคูปองต้องตั้ง cooldown และคูปองมูลค่าสูงควรใช้ trigger ยอดสั่งซื้อแทน')}</Hint>}
      {def && <Field label={__uiText('เงื่อนไข attribute (ทุกข้อ)')}><FilterEditor filters={config.filters} types={typesOf(def)} onChange={(filters) => onChange({ ...config, filters })} /></Field>}
      <Checkbox checked={config.includeGuests} onChange={(e) => onChange({ ...config, includeGuests: e.target.checked })} label={__uiText('รวม guest (ยังไม่ login)')} />
      {config.includeGuests && <Hint>{__uiText('guest ได้เฉพาะ push ถึงอุปกรณ์ที่กดรับ push ไม่เกิน 1 ครั้ง/วัน · ใช้ Audience และ Event condition ไม่ได้ · ต้องให้ DPO ยืนยันก่อนเปิดใช้จริง')}</Hint>}
    </div>
  );
}

export function WaitEventForm({ step, definitions, triggerDef, maxMinutes, onChange }: {
  step: Of<'wait_event'>; definitions: EventDefinition[]; triggerDef: EventDefinition | undefined; maxMinutes: number; onChange: (s: WorkflowStep) => void;
}) {
  __useUiLocale();
  const def = pick(definitions, step.eventName);
  const total = step.timeoutHours * 60 + (step.timeoutMinutes ?? 0);
  const int = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));
  return (
    <div className="space-y-3">
      <Field label={__uiText('รอ event')}><EventSelect value={step.eventName} definitions={definitions} onChange={(eventName) => onChange({ ...step, eventName, filters: [] })} /></Field>
      {def && <Field label={__uiText('เงื่อนไข attribute')}>
        <FilterEditor filters={step.filters} types={typesOf(def)} triggerTypes={triggerDef ? typesOf(triggerDef) : null} onChange={(filters) => onChange({ ...step, filters })} />
      </Field>}
      <div className="grid grid-cols-2 gap-2">
        <Field label={__uiText('หมดเวลา (ชั่วโมง)')}><Input type="number" min={0} value={step.timeoutHours} onChange={(e) => onChange({ ...step, timeoutHours: int(e.target.value) })} /></Field>
        <Field label={__uiText('นาที')}><Input type="number" min={0} max={59} value={step.timeoutMinutes ?? 0} onChange={(e) => onChange({ ...step, timeoutMinutes: Math.min(59, int(e.target.value)) })} /></Field>
      </div>
      {(total < 1 || total > maxMinutes) && <Hint>{__uiText('รอได้ 1 นาที ถึง 30 วัน')}</Hint>}
      <Hint>{__uiText('นับเฉพาะ event หลังเข้า step นี้ · เกิดขึ้น → ทางออกบน · ครบเวลา → ทางออกล่าง')}</Hint>
    </div>
  );
}

export function EventSplitForm({ step, definitions, segments, onChange }: { step: Of<'event_split'>; definitions: EventDefinition[]; segments: DynamicSegment[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  return (
    <div className="space-y-2">
      <EventRuleBuilder rule={step.rule} definitions={definitions} segments={segments} allowSegments onChange={(rule) => onChange({ ...step, rule })} />
      <Hint>{__uiText('ไป Yes เมื่อเงื่อนไขเป็นจริง ณ ตอนที่ลูกค้ามาถึง step นี้')}</Hint>
    </div>
  );
}

/** Audience add-ons: dynamic segments (any of / none of) and an inline event rule (spec §11). */
export function AudienceEventFields({ step, definitions, segments, onChange }: { step: Of<'audience'>; definitions: EventDefinition[]; segments: DynamicSegment[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const toggle = (key: 'dynamicSegmentIds' | 'excludeDynamicSegmentIds', id: string) => {
    const cur = step[key] ?? [];
    onChange({ ...step, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <div className="space-y-4">
      {(['dynamicSegmentIds', 'excludeDynamicSegmentIds'] as const).map((key) => (
        <Field key={key} label={key === 'dynamicSegmentIds' ? __uiText('อยู่ในกลุ่มตาม event ใดก็ได้') : __uiText('ยกเว้นกลุ่มตาม event')}>
          <div className="space-y-1">{segments.map((s) => <Checkbox key={s.id} checked={(step[key] ?? []).includes(s.id)} onChange={() => toggle(key, s.id)} label={s.name} />)}</div>
        </Field>
      ))}
      <Checkbox checked={!!step.eventRule} onChange={(e) => onChange({ ...step, eventRule: e.target.checked ? { op: 'AND', children: [] } : null })} label={__uiText('เพิ่มเงื่อนไข event')} />
      {step.eventRule && <EventRuleBuilder rule={step.eventRule} definitions={definitions} segments={segments} allowSegments onChange={(eventRule) => onChange({ ...step, eventRule })} />}
    </div>
  );
}

/** Exit goal: none / order placed (server) / an event (spec §9). */
export function GoalFields({ input, definitions, onChange }: { input: WorkflowInput; definitions: EventDefinition[]; onChange: (p: Partial<WorkflowInput>) => void }) {
  __useUiLocale();
  const g = input.exitOnGoal;
  const triggerDef = input.triggerType === 'event' ? pick(definitions, (input.triggerConfig as EventTriggerConfig).eventName) : undefined;
  const set = (exitOnGoal: ExitGoal) => onChange({ exitOnGoal });
  return (
    <div className="space-y-2">
      <Field label={__uiText('หยุดส่งเมื่อ')}>
        <Select value={g?.kind ?? 'none'} onChange={(e) => set(e.target.value === 'none' ? null : e.target.value === 'order_placed' ? { kind: 'order_placed' } : { kind: 'event', eventName: '', filters: [] })}>
          <option value="none">{__uiText('ไม่หยุด')}</option>
          <option value="order_placed">{__uiText('ลูกค้าสั่งซื้อแล้ว (จากระบบ)')}</option>
          <option value="event">{__uiText('ลูกค้าทำ event')}</option>
        </Select>
      </Field>
      {g?.kind === 'event' && (
        <>
          <EventSelect value={g.eventName} definitions={definitions} onChange={(eventName) => set({ kind: 'event', eventName, filters: [] })} />
          {pick(definitions, g.eventName)?.evidence === 'browser' && <Hint>{__uiText('event จากหน้าเว็บไม่ใช่หลักฐานการซื้อ — ถ้าเป้าหมายคือการสั่งซื้อ ใช้ "ลูกค้าสั่งซื้อแล้ว"')}</Hint>}
          {pick(definitions, g.eventName) && <FilterEditor filters={g.filters} types={typesOf(pick(definitions, g.eventName))}
            triggerTypes={triggerDef ? typesOf(triggerDef) : null} onChange={(filters) => set({ ...g, filters })} />}
        </>
      )}
    </div>
  );
}
```

`TriggerForm.tsx`:
- `TRIGGER_DEFAULTS` gains `event: { eventName: '', filters: [], includeGuests: false }`.
- `describeTrigger`: `if (type === 'event') return { title, subtitle: (c.eventName as string) || __uiText('ยังไม่เลือก event') };`.
- `TriggerForm` props gain `definitions: EventDefinition[]`; render `{input.triggerType === 'event' && <EventTriggerFields config={input.triggerConfig as EventTriggerConfig} definitions={p.definitions} onChange={(c) => onChange({ triggerConfig: c })} />}` and replace the "หยุดส่งเมื่อลูกค้าสั่งซื้อแล้ว" checkbox with `<GoalFields input={input} definitions={definitions} onChange={onChange} />`.

`StepForms.tsx` `describeStep` cases (ctx gains `definitions` names via a `Map`):

```ts
    case 'wait_event': return { title: label('wait_event'), subtitle: `${step.eventName || '—'} · ${step.timeoutHours} ชม.` };
    case 'event_split': return { title: label('event_split'), subtitle: describeRule(step.rule, new Map()) };
```

`StepPanel.tsx` props gain `definitions: EventDefinition[]; dynamicSegments: DynamicSegment[]`; render:

```tsx
        {p.selection === TRIGGER && <TriggerForm input={p.input} definitions={p.definitions} onChange={p.onChangeInput} />}
        {step?.type === 'audience' && <><AudienceForm step={step} segments={p.segments} onChange={p.onChangeStep} />
          <AudienceEventFields step={step} definitions={p.definitions} segments={p.dynamicSegments} onChange={p.onChangeStep} /></>}
        {step?.type === 'wait_event' && <WaitEventForm step={step} definitions={p.definitions} maxMinutes={p.meta.limits.maxWaitMinutes} onChange={p.onChangeStep}
          triggerDef={p.input.triggerType === 'event' ? p.definitions.find((d) => d.name === (p.input.triggerConfig as EventTriggerConfig).eventName) : undefined} />}
        {step?.type === 'event_split' && <EventSplitForm step={step} definitions={p.definitions} segments={p.dynamicSegments} onChange={p.onChangeStep} />}
```

`FlowEditorPage.tsx`: state `definitions` and `dynamicSegments`; `load` adds `eventsApi.definitions()` and `dynamicSegmentsApi.list()` to the `Promise.all` (set `definitions.definitions`); pass both to `StepPanel`. In `TestRunModal` add, when the workflow trigger is `event`, a `Textarea` "attribute ตัวอย่าง (JSON)" whose parsed object goes to `flowsApi.testRun(id, chosen, skipWaits, attrs)` (invalid JSON → show `__uiText('JSON ไม่ถูกต้อง')`, don't send). `TestRunModal` gets a `triggerType` prop.

- [ ] **Step 5: Run the tests and type check**

Run: `npx vitest run apps/commerce-admin/src/app/pages --config apps/commerce-admin/vite.config.mts` — expected PASS.
Run: `npx tsc --noEmit -p apps/commerce-admin/tsconfig.app.json` — expected 0 errors.

- [ ] **Step 6: Browser check (localhost)** — start commerce-platform (with `MARKETING_EVENTS_INGEST_ENABLED=true`) and commerce-admin; open `/marketing/events`, create event `test_claude_event` with `order_id:string`, `price:number`; post two events with curl:

```bash
curl -s -X POST localhost:3333/api/events -H 'content-type: application/json' -d '{"schemaVersion":1,"deviceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","platform":"web","events":[{"eventId":"'$(uuidgen | tr A-Z a-z)'","name":"test_claude_event","occurredAt":"'$(date -u +%FT%TZ)'","attributes":{"order_id":"O1","price":600}}]}'
```

(port: commerce-platform's local port from `.env`). Expect `accepted`, then `duplicate` on resend of the same id. In `/marketing/flows/new`: Entry "เมื่อเกิด event" → `test_claude_event` price ≥ 500 → Wait for event (`test_claude_event`, `order_id` = from trigger) → push on "หมดเวลา"; the card shows two exits; issues clear; run a test with the tester and sample attributes `{"order_id":"O1","price":600}`. Create a dynamic segment "test_claude_event ≥ 1 ใน 1 วัน" and press "นับลูกค้าตอนนี้".

- [ ] **Step 7: Commit**

```bash
git add apps/commerce-admin/src/app/pages/marketing-workflow libs/ui/src/locales/ui-messages.json
git commit -m "feat(admin): event trigger, wait for event, event condition, event goals and guest switch in the journey editor"
```

---

## Part C — josh and shop-web

Set up once (josh repo): `git -C /Users/pongpanot_s/Documents/dev/josh fetch origin main && git -C /Users/pongpanot_s/Documents/dev/josh worktree add ../josh-worktrees/commerce-event-layer -b feat/commerce-event-layer origin/main`. All paths in Tasks 15–17 are relative to that worktree. Run tests with `npx nx test backend -- <spec path>` / `npx nx test shop-web -- <spec path>`; lint with `npx nx lint backend` / `npx nx lint shop-web`.

### Task 15: josh — `device.snapshot` through the commerce outbox

**Files:**
- Create: `apps/backend/src/migrations/1792480000000-CommerceOutboxUserDevices.ts`
- Modify: `apps/backend/src/app/commerce-events/commerce-snapshot.builder.ts` (+ `.spec.ts`), `commerce-outbox.drainer.ts`, `commerce-backfill.controller.ts`
- Test: `apps/backend/src/app/commerce-events/commerce-outbox.trigger.db.spec.ts` (opt-in DB spec)

**Interfaces:**
- Produces: josh → commerce `device.snapshot` with data = `{ id, user_id, individual_id, platform, first_seen_at, last_seen_at }` (consumed by commerce Task 6), `device.deleted` (generic), backfill group `device`.

- [ ] **Step 1: Write the failing tests**

`commerce-snapshot.builder.spec.ts`:

```ts
  it('device.snapshot carries the user_devices link columns only', async () => {
    const row = { id: 'd1', user_id: 'u1', individual_id: 'a'.repeat(32), platform: 'web', first_seen_at: 't0', last_seen_at: 't1', version: '70' };
    const { builder, query } = makeBuilder([[row]]);
    const [snap] = await builder.build('device', ['d1']);
    expect(snap).toMatchObject({ type: 'device.snapshot', aggregateId: 'd1', version: '70', data: { user_id: 'u1', individual_id: 'a'.repeat(32), platform: 'web', last_seen_at: 't1' } });
    expect(query.mock.calls[0][0]).toContain('FROM user_devices d WHERE d.id = ANY($1::uuid[])');
  });
```

`commerce-outbox.trigger.db.spec.ts` (inside its `describe`, using its `inRollback` / `outbox` helpers):

```ts
  it('user_devices: a new row and a user change enqueue device; a plain save does not', async () => {
    await inRollback(async (q) => {
      const [a, b] = await q(`SELECT id FROM users ORDER BY created_at LIMIT 2`);
      const [d] = await q(`INSERT INTO user_devices (user_id, individual_id, platform) VALUES ($1, 'trigger-spec-device', 'web') RETURNING id`, [a.id]);
      expect(await outbox(q, 'device')).toEqual([{ aggregate_id: d.id }]);
      await q(`UPDATE user_devices SET last_seen_at = now() WHERE id = $1`, [d.id]);
      expect(await outbox(q, 'device')).toEqual([{ aggregate_id: d.id }]);
      await q(`UPDATE user_devices SET user_id = $2 WHERE id = $1`, [d.id, b.id]);
      expect(await outbox(q, 'device')).toEqual([{ aggregate_id: d.id }, { aggregate_id: d.id }]);
    });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx nx test backend -- apps/backend/src/app/commerce-events/commerce-snapshot.builder.spec.ts`
Expected: FAIL (`device` falls through to the order query).

- [ ] **Step 3: Implement**

Migration (copy of the branch pattern):

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * user_devices → commerce (device.snapshot, commerce spec 2026-10-10-marketing-event-layer §5, §15): commerce links
 * behaviour events to customers. Only a new row or a user change — every login saves the row (last_seen_at).
 */
export class CommerceOutboxUserDevices1792480000000 implements MigrationInterface {
  name = 'CommerceOutboxUserDevices1792480000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_device AFTER INSERT OR DELETE ON user_devices
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_reference('device')`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_device_upd AFTER UPDATE OF user_id ON user_devices
      FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id) EXECUTE FUNCTION commerce_outbox_reference('device')`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS commerce_outbox_device_upd ON user_devices`);
    await q.query(`DROP TRIGGER IF EXISTS commerce_outbox_device ON user_devices`);
  }
}
```

Builder: `type ReferenceType = … | 'device';` and in `REFERENCE`:

```ts
  // Commerce event layer: device → customer links. No fingerprint, no OneSignal ids beyond the device id itself.
  device: `SELECT d.id::text AS id, d.user_id::text AS user_id, d.individual_id, d.platform, d.first_seen_at, d.last_seen_at,
    nextval('commerce_snapshot_seq')::text AS version FROM user_devices d WHERE d.id = ANY($1::uuid[])`,
```

Drainer: add `'device'` to `SNAPSHOT_TYPES`. Backfill: `device: \`INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'device', d.id FROM user_devices d\`,`.

- [ ] **Step 4: Run the tests**

Run: `npx nx test backend -- apps/backend/src/app/commerce-events` — expected PASS (the trigger DB spec runs only with `JOSH_SCOPE_TEST_DATABASE_URL`; run it if available, else report skipped).
Run: `npx nx lint backend` — expected 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/migrations/1792480000000-CommerceOutboxUserDevices.ts apps/backend/src/app/commerce-events
git commit -m "feat(commerce-events): send user_devices links to commerce (device.snapshot)"
```

### Task 16: josh — `marketing.notify` to a guest device

**Files:**
- Modify: `apps/backend/src/shared/notification/onesignal.util.ts`
- Modify: `apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.ts` (+ `.spec.ts`)

**Interfaces:**
- Consumes: commerce `MarketingNotifyPayload` with `userId: null` and `target: { kind: 'device', subscriptionId, platform }` (Task 10).
- Produces: `OneSignalClient.sendToSubscription(subscriptionId, category, headings, contents, data, imageUrl?)`; `notify()` returns `'sent' | 'marketing_opt_out' | 'frequency_cap' | 'template_missing' | 'failed'`.

- [ ] **Step 1: Write the failing tests** — in `commerce-marketing-events.service.spec.ts`:

```ts
  it('a device target pushes to that OneSignal subscription with the template copy, no user lookups', async () => {
    const send = jest.spyOn(OneSignalClient, 'sendToSubscription').mockResolvedValue({ ok: true, messageId: 'm1' });
    const { svc, notifications, runner, templates } = setup({ template: { title: 'ตะกร้ารออยู่', body: 'กลับมาซื้อ', image_url: null, channels: null } });
    const r = await svc.notify(Object.assign(new MarketingNotifyDto(), { templateKey: 'custom_cart', channels: ['push'], data: { event: { item_id: 'SKU-1' } },
      dedupeKey: `cmw:${U}:${U}:${U}`, target: { kind: 'device', subscriptionId: S, platform: 'web' } }));
    expect(r).toBe('sent');
    expect(send).toHaveBeenCalledWith(S, 'marketing', expect.objectContaining({ en: 'ตะกร้ารออยู่' }), expect.objectContaining({ en: 'กลับมาซื้อ' }),
      expect.objectContaining({ source: 'commerce', event: { item_id: 'SKU-1' } }), undefined);
    expect(notifications.dispatch).not.toHaveBeenCalled();
    expect(runner.isGlobalFrequencyCapReached).not.toHaveBeenCalled();
    expect(templates.findByKey).toHaveBeenCalledWith('custom_cart');
  });

  it('validates: a user id or a device target, never neither', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const base = { templateKey: 'custom_cart', channels: ['push'], dedupeKey: `cmw:${U}:${U}:${U}` };
    await expect(pipe.transform(base, { type: 'body', metatype: MarketingNotifyDto })).rejects.toBeDefined();
    await expect(pipe.transform({ ...base, target: { kind: 'device', subscriptionId: S, platform: 'web' } }, { type: 'body', metatype: MarketingNotifyDto })).resolves.toBeDefined();
    await expect(pipe.transform({ ...base, userId: U }, { type: 'body', metatype: MarketingNotifyDto })).resolves.toBeDefined();
  });
```

(`U`, `S` = two uuids; extend the spec's existing `setup()` to accept a template — follow its current shape; import `ValidationPipe` from `@nestjs/common`, `OneSignalClient` from `../../shared/notification/onesignal.util`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx nx test backend -- apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`onesignal.util.ts` — refactor the request into one private sender and add the subscription variant:

```ts
  static sendToExternalUser(userId: string, category: string, headings: Record<string, string>, contents: Record<string, string>,
    data: Record<string, unknown>, imageUrl?: string): Promise<{ ok: boolean; reason?: string; messageId?: string }> {
    return this.send({ include_aliases: { external_id: [userId] } }, category, headings, contents, data, imageUrl);
  }

  /** A device that subscribed to push without logging in (commerce guest journeys). */
  static sendToSubscription(subscriptionId: string, category: string, headings: Record<string, string>, contents: Record<string, string>,
    data: Record<string, unknown>, imageUrl?: string): Promise<{ ok: boolean; reason?: string; messageId?: string }> {
    return this.send({ include_subscription_ids: [subscriptionId] }, category, headings, contents, data, imageUrl);
  }

  private static async send(target: Record<string, unknown>, category: string, headings: Record<string, string>, contents: Record<string, string>,
    data: Record<string, unknown>, imageUrl?: string): Promise<{ ok: boolean; reason?: string; messageId?: string }> {
    // body of the old sendToExternalUser, with `include_aliases: { external_id: [userId] }` replaced by `...target`
  }
```

`commerce-marketing-events.service.ts`:

```ts
import { Type } from 'class-transformer';
import { ValidateIf, ValidateNested } from 'class-validator';
import { OneSignalClient } from '../../shared/notification/onesignal.util';

export class MarketingNotifyTargetDto {
  @IsIn(['device']) kind!: 'device';
  @IsUUID() subscriptionId!: string;
  @IsIn(['web', 'ios', 'android']) platform!: 'web' | 'ios' | 'android';
}

export class MarketingNotifyDto {
  /** Required unless `target` names a guest device. */
  @ValidateIf((o: MarketingNotifyDto) => !o.target) @IsUUID() userId?: string;
  @IsOptional() @ValidateNested() @Type(() => MarketingNotifyTargetDto) target?: MarketingNotifyTargetDto;
  // templateKey / channels / data / dedupeKey unchanged
}

  async notify(dto: MarketingNotifyDto): Promise<'sent' | 'marketing_opt_out' | 'frequency_cap' | 'template_missing' | 'failed'> {
    if (dto.target) return this.notifyDevice(dto, dto.target);
    const userId = dto.userId!;
    // … the existing body, with dto.userId → userId
  }

  /**
   * Guest push (commerce spec §10, §15): no user, so no opt-out row and no user variables — the template renders with
   * empty user fields; commerce caps guest pushes per device. Push only.
   */
  private async notifyDevice(dto: MarketingNotifyDto, target: MarketingNotifyTargetDto): Promise<'sent' | 'template_missing' | 'failed'> {
    const template = await this.templates.findByKey(dto.templateKey);
    if (!template) return 'template_missing';
    const o = buildNotifyTemplateOverride(template, {}, 'th');
    const headings = { ...(o.titleByLocale ?? {}), en: o.titleByLocale?.en ?? o.title };
    const contents = { ...(o.bodyByLocale ?? {}), en: o.bodyByLocale?.en ?? o.body };
    const r = await OneSignalClient.sendToSubscription(target.subscriptionId, 'marketing', headings, contents,
      { ...(dto.data ?? {}), source: 'commerce' }, o.imageUrl ?? undefined);
    return r.ok ? 'sent' : 'failed';
  }
```

(`class-transformer` is already a josh dependency — confirm with `grep '"class-transformer"' package.json`; if missing, validate `target` with `@IsObject()` plus a check in `notifyDevice` instead of adding a dependency.)

- [ ] **Step 4: Run the tests**

Run: `npx nx test backend -- apps/backend/src/app/marketing-workflow apps/backend/src/app/erp apps/backend/src/app/notification` — expected PASS.
Run: `npx nx lint backend` — expected 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/shared/notification/onesignal.util.ts apps/backend/src/app/marketing-workflow/commerce-marketing-events.service*
git commit -m "feat(marketing-workflow): commerce guest push to a OneSignal subscription"
```

### Task 17: shop-web — send events to commerce

**Files:**
- Create: `apps/shop-web/src/lib/commerce-events.ts` (+ `commerce-events.spec.ts`)
- Modify: `apps/shop-web/src/lib/analytics.ts`, `apps/shop-web/src/lib/onesignal-types.ts`, `apps/shop-web/src/components/OneSignalBootstrap.tsx`
- Modify: `apps/shop-web/.env.example` (or the env doc shop-web uses)

**Interfaces:**
- Consumes: commerce `POST /api/events` (Task 5).
- Produces: `queueCommerceEvent(name: string, payload: Record<string, unknown>, ctx: { deviceId: string; loggedIn: boolean; companyId?: string; branchId?: string }): void`, `flushCommerceEvents(): Promise<void>`, `rememberPushSubscription(id: string | null): void`.

- [ ] **Step 1: Write the failing test** `commerce-events.spec.ts` (use the runner shop-web already uses for `lib/*.spec.ts`):

```ts
import { flushCommerceEvents, queueCommerceEvent, rememberPushSubscription, __resetForTests } from './commerce-events';

const fetchMock = jest.fn(async () => ({ ok: true }));
beforeEach(() => {
  jest.useFakeTimers();
  __resetForTests('https://commerce.test/api/events');
  fetchMock.mockClear();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});
afterEach(() => jest.useRealTimers());
const ctx = { deviceId: 'a'.repeat(32), loggedIn: true, companyId: 'c1', branchId: 'b1' };
const sent = () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);

it('batches for 2 s, sends scalars only, never search free text, with context and push subscription', async () => {
  rememberPushSubscription('5b000000-0000-4000-8000-000000000001');
  queueCommerceEvent('add_to_cart', { item_id: 'SKU-1', quantity: 2, items: [{ x: 1 }] }, ctx);
  queueCommerceEvent('search', { search_term: 'ชื่อร้านฉัน 0812345678', search_type: 'keyword' }, ctx);
  queueCommerceEvent('chat_proactive_shown', { item_id: 'x' }, ctx); // not in the commerce catalog
  expect(fetchMock).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(2000);
  const body = sent();
  expect(body).toMatchObject({ schemaVersion: 1, deviceId: ctx.deviceId, platform: 'web', pushSubscriptionId: '5b000000-0000-4000-8000-000000000001' });
  expect(body.events.map((e: { name: string }) => e.name)).toEqual(['add_to_cart', 'search']);
  expect(body.events[0]).toMatchObject({ attributes: { item_id: 'SKU-1', quantity: 2 }, context: { companyId: 'c1', branchId: 'b1', actorKind: 'customer' } });
  expect(body.events[1].attributes).toEqual({ search_type: 'keyword' });
  expect((fetchMock.mock.calls[0] as unknown as [string, { keepalive: boolean }])[1].keepalive).toBe(true);
});

it('flushes at 20 events and swallows network errors', async () => {
  fetchMock.mockRejectedValueOnce(new Error('down'));
  for (let i = 0; i < 20; i++) queueCommerceEvent('view_item', { item_id: `S${i}` }, ctx);
  await flushCommerceEvents();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sent().events).toHaveLength(20);
});

it('does nothing without the commerce URL', async () => {
  __resetForTests(undefined);
  queueCommerceEvent('view_item', { item_id: 'S' }, ctx);
  await jest.advanceTimersByTimeAsync(2000);
  expect(fetchMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx nx test shop-web -- apps/shop-web/src/lib/commerce-events.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `lib/commerce-events.ts`:

```ts
/**
 * Behaviour events → commerce (commerce spec 2026-10-10-marketing-event-layer §16). Fire-and-forget: batched for 2 s or
 * 20 events, `keepalive` so a batch survives navigation, 3 s timeout, no retry, never throws. josh ingest keeps running
 * beside it until commerce runs every workflow (phase 3).
 */
const CATALOG = new Set(['view_item', 'view_category', 'search', 'add_to_cart', 'begin_checkout', 'purchase', 'login']);
/** Free text / identifiers commerce must not receive (BA §6: no search text). */
const NEVER = new Set(['search_term']);
const MAX = 20;

type Pending = { eventId: string; name: string; occurredAt: string; context: Record<string, string>; attributes: Record<string, string | number | boolean> };
let url: string | undefined = process.env.NEXT_PUBLIC_COMMERCE_EVENTS_URL;
let queue: Pending[] = [];
let deviceId = '';
let pushSubscriptionId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const uuid = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)));

export function rememberPushSubscription(id: string | null): void { pushSubscriptionId = id; }

export function queueCommerceEvent(name: string, payload: Record<string, unknown>,
  ctx: { deviceId: string; loggedIn: boolean; companyId?: string; branchId?: string }): void {
  if (!url || typeof window === 'undefined' || !CATALOG.has(name) || !ctx.deviceId) return;
  const attributes: Pending['attributes'] = {};
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (!NEVER.has(k) && (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) attributes[k] = v;
  }
  const context: Record<string, string> = { actorKind: ctx.loggedIn ? 'customer' : 'anonymous' };
  if (ctx.loggedIn && ctx.companyId) context.companyId = ctx.companyId;
  if (ctx.loggedIn && ctx.branchId) context.branchId = ctx.branchId;
  if (deviceId && deviceId !== ctx.deviceId) void flushCommerceEvents();
  deviceId = ctx.deviceId;
  queue.push({ eventId: uuid(), name, occurredAt: new Date().toISOString(), context, attributes });
  if (queue.length >= MAX) void flushCommerceEvents();
  else timer ??= setTimeout(() => void flushCommerceEvents(), 2000);
}

export async function flushCommerceEvents(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!url || !queue.length) return;
  const events = queue.splice(0, MAX);
  const body = JSON.stringify({ schemaVersion: 1, deviceId, platform: 'web', ...(pushSubscriptionId ? { pushSubscriptionId } : {}), events });
  try {
    await fetch(url, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body,
      ...(typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? { signal: AbortSignal.timeout(3000) } : {}) });
  } catch {
    // fire-and-forget: commerce down never affects the shop
  }
  if (queue.length) await flushCommerceEvents();
}

/** Tests only. */
export function __resetForTests(next: string | undefined): void { url = next; queue = []; deviceId = ''; pushSubscriptionId = null; if (timer) clearTimeout(timer); timer = null; }
```

`analytics.ts` `track()` — after the existing `ingestAnalyticsEvent` block (outside its `purchase` exclusion):

```ts
  const session = getShopSession();
  queueCommerceEvent(event, payload as Record<string, unknown>, {
    deviceId: identity.individual_id ?? '', loggedIn: !!identity.user_id, companyId: session.companyId, branchId: session.branchId,
  });
```

(import `queueCommerceEvent` from `./commerce-events` and `getShopSession` from `./cart-session`.)

`onesignal-types.ts`: `PushSubscription` gains `id?: string | null; optedIn?: boolean;`. `OneSignalBootstrap.tsx`: after init, `rememberPushSubscription(OneSignal.User.PushSubscription.optedIn && OneSignal.User.PushSubscription.id && !OneSignal.User.PushSubscription.id.startsWith('local-') ? OneSignal.User.PushSubscription.id : null);` and in the existing `'change'` listener call `rememberPushSubscription(subscribed ? payload.current!.id! : null);`.

Env: add `NEXT_PUBLIC_COMMERCE_EVENTS_URL=` (empty = off) with a one-line comment to the shop-web env example.

- [ ] **Step 4: Run the tests**

Run: `npx nx test shop-web -- apps/shop-web/src/lib` — expected PASS (existing analytics specs unchanged).
Run: `npx nx lint shop-web` — expected 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/shop-web/src/lib/commerce-events* apps/shop-web/src/lib/analytics.ts apps/shop-web/src/lib/onesignal-types.ts apps/shop-web/src/components/OneSignalBootstrap.tsx apps/shop-web/.env.example
git commit -m "feat(shop-web): send behaviour events to commerce (batched, fire-and-forget)"
```

---

## Part D — Docs and verification

### Task 18: Contracts, completion note, full verification

**Files:**
- Modify: `docs/event-contract.md` (commerce)
- Create: `.claude/completions/2026-10-10-marketing-event-layer.md` (commerce)

- [ ] **Step 1: Contract docs** — in `docs/event-contract.md`:
  - josh → commerce table: add `device.snapshot` (`user_devices` row: `id`, `user_id`, `individual_id`, `platform`, `first_seen_at`, `last_seen_at`; sent on insert and when `user_id` changes; commerce copies to `josh_user_devices`, links the device, re-attributes events) and `device.deleted`; add `"device"` to the backfill group list.
  - commerce → josh: `marketing.notify` may carry `userId: null` + `target: { kind: 'device', subscriptionId, platform }` (push only, OneSignal subscription).
  - New section "Behaviour events ingest (`POST /api/events`)" = spec §3 request / response, limits, rejection reasons, and the mobile contract from spec §16 (`deviceId` = `pushSubscriptionId` = OneSignal subscription id, `platform: ios | android`, batch ≤ 20, fire-and-forget).

- [ ] **Step 2: Full verification (commerce)**

```bash
npx jest -c apps/commerce-platform/jest.config.cts marketing-events marketing-workflow josh-events segments system-health
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
npx nx test commerce-platform
npx vitest run apps/commerce-admin/src --config apps/commerce-admin/vite.config.mts
npx tsc --noEmit -p apps/commerce-admin/tsconfig.app.json
```

Expected: all PASS / 0 errors (note the known pre-existing failure `replica-readers.spec` if it still fails on the base commit). With a migrated local DB: `MARKETING_TEST_DATABASE_URL=… npx jest -c apps/commerce-platform/jest.config.cts "\.db\.spec"`; migration up / down / up.

- [ ] **Step 3: Full verification (josh)** — `npx nx test backend -- apps/backend/src/app/commerce-events apps/backend/src/app/marketing-workflow apps/backend/src/app/erp`, `npx nx test shop-web -- apps/shop-web/src/lib`, `npx nx lint backend`, `npx nx lint shop-web`, `npx tsc --noEmit -p apps/backend/tsconfig.app.json`.

- [ ] **Step 4: End-to-end on localhost** (test DB, both apps): the Task 14 browser check, plus: a josh `user_devices` insert for a tester (or `POST /api/auth/device`) → commerce receives `device.snapshot` → the curl events of that device show `attribution = device_link` in `/marketing/events`; a workflow `add_to_cart → wait purchase 2 min → push` with the tester completes on the timeout branch, and with a `purchase` event inside 2 minutes takes the matched branch. Real sends go only to testers; email only to pongpanot_s@jagota.co.th.

- [ ] **Step 5: Completion note** `.claude/completions/2026-10-10-marketing-event-layer.md`: shipped (commerce branch + commits, josh branch + commits), verification results, not verified, known limits (per-process rate limit; guest consent pending DPO; staff on shared devices; mobile not sending yet), and the rollout order:
  1. commerce-platform deploy + migration `1796400000000` (`MARKETING_EVENTS_INGEST_ENABLED=false`)
  2. josh deploy (migration `1792480000000`, builder, notify device path) → `JOSH_EVENTS_TO_COMMERCE_ENABLED` already on → backfill `{"group":"device"}` via `POST /api/reports/order-copy/backfill`
  3. `MARKETING_EVENTS_INGEST_ENABLED=true`, add the shop domain to `COMMERCE_CORS_ORIGINS`, deploy shop-web with `NEXT_PUBLIC_COMMERCE_EVENTS_URL`
  4. deploy commerce-admin; test with a tester before activating any event workflow; `includeGuests` only after DPO sign-off
  5. hand the §16 mobile contract to the mobile team

- [ ] **Step 6: Commit**

```bash
git add docs/event-contract.md .claude/completions/2026-10-10-marketing-event-layer.md
git commit -m "docs: event layer contracts, mobile ingest contract, completion note"
```
