# Commerce marketing workflow — phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce runs its own marketing workflows (enroll → wait / condition / A/B split / webhook / notify / coupon) with a drag-and-drop journey editor; josh only delivers notify and coupon when commerce asks.

**Architecture:** A new NestJS module `modules/integration/marketing-workflow` in commerce-platform owns workflows, enrollments and action logs. Pure domain code (validator, DSL, template, hashing) sits in `domain/`; all SQL sits in one `WorkflowStore` so the engine is unit-tested with a fake store. Triggers come from josh → commerce snapshots (`customer.snapshot`, `order.snapshot`) through a local EventEmitter signal → BullMQ job. Notify / coupon leave through the transactional outbox as `marketing.notify` / `marketing.grant_coupon` (same path as `winback.notify`); webhooks go through `webhook_deliveries` rows on a marketing-only BullMQ queue. commerce-admin gets a new editor folder `pages/marketing-workflow/` built on `@xyflow/react`, with a pure `workflow-graph.ts` for every graph edit.

**Tech Stack:** NestJS 11, TypeORM (raw SQL + entities), BullMQ, @nestjs/schedule, @nestjs/event-emitter, zod, jest (ts-jest) · React + Vite + Tailwind v4 + `@xyflow/react` 12.12, vitest · josh: NestJS, class-validator, jest.

**Spec:** `docs/superpowers/specs/2026-10-10-marketing-workflow-builder-design.md`

## Global Constraints

- josh changes are additive only: no change to josh cron / runner behaviour; two private methods become public, nothing else in the runner changes. No new josh env flag — the josh webhook subscription's `event_types` is the on-switch.
- Deploy order: josh receiver → commerce-platform → add `marketing.notify,marketing.grant_coupon` to the josh subscription → commerce-admin. josh answers 422 to unknown types and commerce dead-letters 4xx.
- commerce migrations: `apps/commerce-platform/src/migrations/<ts>-Name.ts`, next timestamp **1796300000000**; entity files end in `.entity.ts` (glob-registered); `synchronize` is off; uuid PKs `DEFAULT uuid_generate_v4()`.
- No new npm dependencies.
- Admin controllers: `@StaffRoles('marketing')` (admin always allowed), bodies parsed with zod via `parse()` from `modules/integration/growth/growth.validation.ts`, raw objects returned (no envelope).
- Workflow step ids are uuids. `nextId` is always explicit; the first step is `entry_step_id`.
- Limits (spec): wait steps ≤ 3, condition steps ≤ 5, audience steps ≤ 1, wait total 1 min … 43 200 min, split 2–4 branches with integer percent 1–99 summing to 100, webhook headers ≤ 20, body ≤ 16 KB, url ≤ 1024 chars, webhook timeout 10 s, webhook retries ≤ 20 (`deliveryBackoff`).
- Template variables use josh's syntax `{{user_name}}` (regex `\{\{\s*(\w+)\s*\}\}`); secret refs are the whole header value `{{secret:<uuid>}}`.
- Phase-1 condition fields only: `still_no_order`, `segment.in`, `user.order_count`, `time.in_schedule`, `time.hour`, `time.dow`.
- Phase-1 trigger types only: `scheduled`, `order_milestone`, `first_login`, `app_login`; triggers count only events at/after `activated_at`.
- Counted (paid) orders = `JOSH_ACTIVE_ORDER_STATUSES` from `modules/integration/customers/customer-metrics.service.ts`, date column `create_date`, user column `user_id`, total `total_price`.
- Real test sends go only to testers (`MarketingTesters.assert`); the end-to-end email goes to **pongpanot_s@jagota.co.th**.
- UI copy: every literal through `uiText(...)` with the Thai source string as key; every new key gets `{th, en}` in `libs/ui/src/locales/ui-messages.json` (English with no Thai). New admin folder uses Tailwind v4 (global); reused josh components are wrapped in `<div className="josh-tw">`.
- Keep commits local; do not push (user rule: push once at the end of a work round).

## Review Focus

1. A customer value containing `"`, newline or `&` rendered into a webhook JSON body / header / URL → body stays valid JSON, no header injection, URL stays one parameter. Test: Task 3 `template.spec.ts`.
2. josh re-sends `customer.snapshot` on every `users` update → `first_login` enrolls once ever, `app_login` once per login timestamp. Test: Task 7 `workflow-triggers.spec.ts`.
3. A step deleted (or the workflow paused) while enrollments wait on it → resume ends `skipped: step_removed` / `workflow_paused`, never throws. Test: Task 6 `workflow-engine.spec.ts`.
4. Activating a workflow when thousands already logged in / ordered → nobody before `activated_at` enrolls. Test: Task 7 `workflow-triggers.spec.ts`.
5. A secret header value never appears in API responses, revisions, action logs, delivery rows or error text, even when the target fails. Tests: Task 5 `marketing-webhook.worker.spec.ts`, `webhook-secrets.service.spec.ts`.

---

## File map

**josh** (`/Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-marketing-receiver`, branch `feat/commerce-marketing-receiver` from `origin/main`)
- Create `apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.ts` (+ `.spec.ts`) — the two receivers.
- Modify `apps/backend/src/app/marketing-workflow/marketing-workflow-runner.service.ts` — `buildTemplateVarsForUser`, `isGlobalFrequencyCapReached` public.
- Modify `apps/backend/src/app/marketing-workflow/marketing-workflow.module.ts` — provide/export the new service.
- Modify `apps/backend/src/app/erp/commerce-erp-events.controller.ts` (+ spec), `apps/backend/src/app/erp/erp.module.ts`.

**commerce-platform** (`apps/commerce-platform/src/`)
- `shared-kernel/infrastructure/secret-cipher.ts`, `public-url.ts` (+ specs); `modules/platform/scraping/infrastructure/credential-cipher.ts` uses the new cipher.
- `libs/marketing-workflow/src/index.d.ts` (repo root) — types shared with admin; `tsconfig.base.json` path.
- `modules/integration/marketing-workflow/`
  - `domain/`: `workflow.types.ts`, `expression.parser.ts`, `expression.evaluator.ts`, `expression.fields.ts`, `schedule.ts` (copied from josh), `template.ts`, `bucket.ts`, `workflow.validator.ts` (+ specs)
  - `infrastructure/`: `marketing-workflow.entity.ts`, `marketing-workflow-revision.entity.ts`, `marketing-webhook-secret.entity.ts`, `workflow.store.ts`
  - `application/`: `marketing-events.ts`, `workflow-queue.ts`, `webhook-send.ts`, `webhook-secrets.service.ts`, `marketing-webhook.worker.ts`, `workflow-engine.service.ts`, `workflow-triggers.service.ts`, `workflow-trigger.listener.ts`, `workflow.processor.ts`, `workflow-sweep.ts`, `workflow.service.ts`, `workflow-analytics.service.ts` (+ specs)
  - `presentation/`: `workflow.schemas.ts`, `marketing-workflow.controller.ts`
  - `marketing-workflow.module.ts`
- `migrations/1796300000000-CommerceMarketingWorkflows.ts`
- Modify: `config/redis.config.ts` (2 queues), `app.module.ts`, `modules/integration/segments/segments.service.ts` (`userMatchesSegment`, `evaluableSegments`), `modules/integration/customers/customer-metrics.service.ts` (export statuses), `modules/integration/connector/josh/events/josh-events.service.ts` (+ spec) (signals), `modules/integration/webhook-subscription/infrastructure/webhook-delivery.entity.ts`, `.../application/webhook-delivery.worker.ts` (skip non-event rows), `apps/commerce-platform/.env.example`, `docs/event-contract.md`.

**commerce-admin** (`apps/commerce-admin/src/`)
- `lib/api.ts` — `flowsApi`.
- `app/pages/marketing-workflow/`: `workflow-graph.ts` (+ spec), `palette.ts`, `Palette.tsx`, `NodeCard.tsx`, `FlowCanvas.tsx`, `forms/TriggerForm.tsx`, `forms/StepForms.tsx`, `forms/WebhookForm.tsx`, `forms/SplitForm.tsx`, `StepPanel.tsx`, `FlowResults.tsx`, `FlowEditorPage.tsx`, `index.tsx`
- Modify: `app/app.tsx` (routes), `app/pages/MarketingWorkflows.tsx` (commerce group + create button), `app/pages/workflow-editor/josh/TriggerRuleBuilder.tsx`, `MarketingStepSidePanel.tsx`, `MarketingWorkflowEditor.tsx` (add `export` to 5 internal components), `libs/ui/src/locales/ui-messages.json`.

---

### Task 0: Workspaces

**Files:** none (setup)

- [ ] **Step 1: josh worktree from origin/main**

```bash
git -C /Users/pongpanot_s/Documents/dev/josh fetch origin main
git -C /Users/pongpanot_s/Documents/dev/josh worktree add /Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-marketing-receiver -b feat/commerce-marketing-receiver origin/main
ln -s /Users/pongpanot_s/Documents/dev/josh/node_modules /Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-marketing-receiver/node_modules
```

- [ ] **Step 2: commerce worktree node_modules**

The commerce worktree (`/Users/pongpanot_s/Documents/dev/commerce-platform/.claude/worktrees/marketing-workflow-0f1cc5`, branch `claude/marketing-workflow-0f1cc5`) has no `node_modules`.

```bash
cd /Users/pongpanot_s/Documents/dev/commerce-platform/.claude/worktrees/marketing-workflow-0f1cc5
ln -s /Users/pongpanot_s/Documents/dev/commerce-platform/node_modules node_modules
npx jest -c apps/commerce-platform/jest.config.cts josh-events.service
```
Expected: the existing `josh-events.service.spec.ts` passes (proves the toolchain works from the worktree). If `ln` reports the path exists, skip it.

- [ ] **Step 3: baseline admin tests**

```bash
npx vitest run apps/commerce-admin/src/lib/role-home.spec.ts --config apps/commerce-admin/vite.config.mts
```
Expected: PASS.

---

### Task 1: josh — receive `marketing.notify` and `marketing.grant_coupon`

All paths relative to the josh worktree. Run tests with `npx nx test backend -- <spec path>` (`--testFile=` is ignored by this repo's setup).

**Files:**
- Create: `apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.ts`
- Test: `apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.spec.ts`
- Modify: `apps/backend/src/app/marketing-workflow/marketing-workflow-runner.service.ts` (~L756 and ~L1710)
- Modify: `apps/backend/src/app/marketing-workflow/marketing-workflow.module.ts` (providers / exports ~L129-137)
- Modify: `apps/backend/src/app/erp/commerce-erp-events.controller.ts` (HANDLERS ~L98-181, constructor ~L203)
- Modify: `apps/backend/src/app/erp/commerce-erp-events.controller.spec.ts` (`setup()` ~L15-44)
- Modify: `apps/backend/src/app/erp/erp.module.ts`

**Interfaces:**
- Produces (josh, consumed by commerce over HTTP): envelope `data` for `marketing.notify` = `{ userId: uuid, templateKey: string, channels: ('push'|'email'|'in_app')[], data?: object, dedupeKey: 'cmw:<wfId>:<enrollmentId>:<stepId>' }`; `marketing.grant_coupon` = `{ userId: uuid, couponId: uuid }`. Responses: 2xx `{ received: true, outcome: 'sent'|'marketing_opt_out'|'frequency_cap'|'granted'|'already_granted' }`; 422 on invalid payload.

- [ ] **Step 1: Write the failing service spec**

```ts
// apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.spec.ts
jest.mock('./marketing-notify-override', () => ({
  buildNotifyTemplateOverride: jest.fn(() => ({ title: 'T', body: 'B' })),
}));
import { CommerceMarketingEventsService } from './commerce-marketing-events.service';

const UID = '11111111-1111-4111-8111-111111111111';
const dto = { userId: UID, templateKey: 'custom_welcome', channels: ['email' as const], dedupeKey: `cmw:${UID}:${UID}:${UID}` };

function setup(over: { cap?: boolean; template?: unknown; results?: unknown[]; created?: boolean } = {}) {
  const notifications = { dispatch: jest.fn(async () => over.results ?? [{ channel: 'email', ok: true }]) };
  const coupons = { grantFromMarketingWorkflow: jest.fn(async () => ({ created: over.created ?? true, entitlementId: 'e1' })) };
  const templates = { findByKey: jest.fn(async () => over.template ?? null) };
  const runner = {
    isGlobalFrequencyCapReached: jest.fn(async () => over.cap ?? false),
    buildTemplateVarsForUser: jest.fn(async () => ({ user_name: 'Nok', __locale: 'en' })),
  };
  const svc = new CommerceMarketingEventsService(notifications as never, coupons as never, templates as never, runner as never);
  return { svc, notifications, coupons, templates, runner };
}

describe('CommerceMarketingEventsService', () => {
  it('dispatches a marketing notify with commerce dedupe key and the channels asked for', async () => {
    const { svc, notifications } = setup();
    await expect(svc.notify(dto)).resolves.toBe('sent');
    expect(notifications.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userId: UID, type: 'custom_welcome', category: 'marketing', channels: ['email'], dedupeKey: dto.dedupeKey,
    }));
  });

  it('renders an admin template with the recipient vars and locale', async () => {
    const { svc, notifications, runner } = setup({ template: { key: 'custom_welcome' } });
    await svc.notify(dto);
    expect(runner.buildTemplateVarsForUser).toHaveBeenCalledWith(UID);
    expect(notifications.dispatch).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en', override: { title: 'T', body: 'B' } }));
  });

  it('skips without sending when the josh global frequency cap is reached', async () => {
    const { svc, notifications } = setup({ cap: true });
    await expect(svc.notify(dto)).resolves.toBe('frequency_cap');
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('reports marketing_opt_out when no channel was sent', async () => {
    const { svc } = setup({ results: [] });
    await expect(svc.notify(dto)).resolves.toBe('marketing_opt_out');
  });

  it('grants the coupon from the workflow, idempotently', async () => {
    await expect(setup().svc.grantCoupon({ userId: UID, couponId: UID })).resolves.toBe('granted');
    await expect(setup({ created: false }).svc.grantCoupon({ userId: UID, couponId: UID })).resolves.toBe('already_granted');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './commerce-marketing-events.service'`)

Run: `npx nx test backend -- apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.spec.ts`

- [ ] **Step 3: Make the two runner helpers public**

In `marketing-workflow-runner.service.ts` change `private async buildTemplateVarsForUser(` → `async buildTemplateVarsForUser(` and `private async isGlobalFrequencyCapReached(` → `async isGlobalFrequencyCapReached(`. Add above each a one-line comment: `/** Also used by CommerceMarketingEventsService (commerce-run workflows). */`. No other change.

- [ ] **Step 4: Write the service**

```ts
// apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.ts
import { Injectable } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { NotificationService } from '../notification/notification.service';
import { CouponEntitlementService } from '../coupon/coupon-entitlement.service';
import { MarketingNotifyTemplateService } from './marketing-notify-template.service';
import { MarketingWorkflowRunnerService } from './marketing-workflow-runner.service';
import { buildNotifyTemplateOverride } from './marketing-notify-override';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `marketing.notify` — a commerce-run marketing workflow reached a notify step; josh delivers it. */
export class MarketingNotifyDto {
  @IsUUID() userId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,100}$/) templateKey!: string;
  @IsArray() @ArrayNotEmpty() @IsIn(['push', 'email', 'in_app'], { each: true }) channels!: Array<'push' | 'email' | 'in_app'>;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsString() @Matches(new RegExp(`^cmw:${UUID}:${UUID}:${UUID}$`)) dedupeKey!: string;
}

/** `marketing.grant_coupon` — a commerce-run workflow grants a coupon; idempotent per coupon + user in josh. */
export class MarketingGrantCouponDto {
  @IsUUID() userId!: string;
  @IsUUID() couponId!: string;
}

/**
 * What commerce sends josh while commerce runs marketing workflows (spec 2026-10-10 §5): josh still delivers,
 * because templates, devices, opt-outs and coupons live here. Same steps as the runner's own notify / grant.
 */
@Injectable()
export class CommerceMarketingEventsService {
  constructor(
    private readonly notifications: NotificationService,
    private readonly coupons: CouponEntitlementService,
    private readonly templates: MarketingNotifyTemplateService,
    private readonly runner: MarketingWorkflowRunnerService,
  ) {}

  async notify(dto: MarketingNotifyDto): Promise<'sent' | 'marketing_opt_out' | 'frequency_cap'> {
    if (await this.runner.isGlobalFrequencyCapReached(dto.userId)) return 'frequency_cap';
    const template = await this.templates.findByKey(dto.templateKey);
    let override: ReturnType<typeof buildNotifyTemplateOverride> | undefined;
    let locale: string | undefined;
    if (template) {
      const vars = await this.runner.buildTemplateVarsForUser(dto.userId);
      locale = vars.__locale;
      override = buildNotifyTemplateOverride(template, vars, locale);
    }
    const results = await this.notifications.dispatch({
      userId: dto.userId,
      type: dto.templateKey,
      category: 'marketing',
      data: { ...(dto.data ?? {}), source: 'commerce' },
      dedupeKey: dto.dedupeKey,
      channels: dto.channels,
      ...(locale === 'en' || locale === 'th' ? { locale } : {}),
      ...(override ? { override } : {}),
    });
    return results.length === 0 ? 'marketing_opt_out' : 'sent';
  }

  async grantCoupon(dto: MarketingGrantCouponDto): Promise<'granted' | 'already_granted'> {
    const result = await this.coupons.grantFromMarketingWorkflow(dto.couponId, dto.userId);
    return result.created ? 'granted' : 'already_granted';
  }
}
```
If TypeScript complains that `vars.__locale` does not exist, mirror the exact expression the runner's notify block uses (~L1810: `recipientLocale = vars.__locale;`).

- [ ] **Step 5: Wire the module**

In `marketing-workflow.module.ts` add `CommerceMarketingEventsService` to `providers` and add both `CommerceMarketingEventsService` and `MarketingNotifyTemplateService` to `exports`.

- [ ] **Step 6: Run the service spec — expect PASS**

Run: `npx nx test backend -- apps/backend/src/app/marketing-workflow/commerce-marketing-events.service.spec.ts`

- [ ] **Step 7: Write the failing controller test**

In `commerce-erp-events.controller.spec.ts`: inside `setup()` add `const marketing = { notify: jest.fn(async () => 'sent'), grantCoupon: jest.fn(async () => 'granted') };`, pass `marketing as never` as the **last** constructor argument of `new CommerceErpEventsController(...)`, and add `marketing` to the object `setup()` returns. Then add next to the winback test (~L303):

```ts
  it('marketing (commerce runs workflows): notify / grant_coupon take the event data itself, validated', async () => {
    const { ctl, marketing } = setup();
    const UID = '11111111-1111-4111-8111-111111111111';
    const n = { type: 'marketing.notify', data: { userId: UID, templateKey: 'custom_x', channels: ['push'], dedupeKey: `cmw:${UID}:${UID}:${UID}` } };
    await expect(ctl.receive(n, sign(n), 'd-m1', n.type)).resolves.toEqual({ received: true, outcome: 'sent' });
    expect(marketing.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: UID, templateKey: 'custom_x' }));
    const bad = { type: 'marketing.notify', data: { userId: UID, templateKey: 'custom_x', channels: ['sms'], dedupeKey: 'x' } };
    await expect(ctl.receive(bad, sign(bad), 'd-m2', bad.type)).rejects.toBeInstanceOf(UnprocessableEntityException);
    const g = { type: 'marketing.grant_coupon', data: { userId: UID, couponId: UID } };
    await expect(ctl.receive(g, sign(g), 'd-m3', g.type)).resolves.toEqual({ received: true, outcome: 'granted' });
  });
```
If `setup()` is destructured differently in the other tests (e.g. `const s = setup()`), follow that style.

- [ ] **Step 8: Run — expect FAIL** (`unsupported event marketing.notify`, 422)

Run: `npx nx test backend -- apps/backend/src/app/erp/commerce-erp-events.controller.spec.ts`

- [ ] **Step 9: Register the handlers**

In `commerce-erp-events.controller.ts`:
- import `{ CommerceMarketingEventsService, MarketingGrantCouponDto, MarketingNotifyDto }` from `'../marketing-workflow/commerce-marketing-events.service'`;
- next to the `'winback.notify'` entry (~L146) add
```ts
  'marketing.notify': { pipe: one(MarketingNotifyDto), input: 'data', run: (c, d) => c.marketing.notify(d) },
  'marketing.grant_coupon': { pipe: one(MarketingGrantCouponDto), input: 'data', run: (c, d) => c.marketing.grantCoupon(d) },
```
  (match the winback entry's exact `run` signature / casts);
- append the last constructor parameter `@Inject(forwardRef(() => CommerceMarketingEventsService)) readonly marketing: CommerceMarketingEventsService`.

In `erp.module.ts` add `forwardRef(() => MarketingWorkflowModule)` to `imports` (import from `'../marketing-workflow/marketing-workflow.module'`).

- [ ] **Step 10: Run both specs + lint — expect PASS**

```bash
npx nx test backend -- apps/backend/src/app/erp/commerce-erp-events.controller.spec.ts
npx nx test backend -- apps/backend/src/app/marketing-workflow
npx nx lint backend
```
The second line also re-runs the runner specs: they must still pass unchanged.

- [ ] **Step 11: Commit (josh worktree)**

```bash
git add apps/backend/src/app/marketing-workflow apps/backend/src/app/erp
git commit -m "feat(marketing): receive marketing.notify / marketing.grant_coupon from commerce-run workflows

Additive: commerce runs its own workflows and asks josh to deliver. Same steps as the
runner's notify / grant (template override, opt-out, josh global frequency cap,
idempotent grant). The josh subscription's event_types is the on-switch.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: commerce — secret cipher + public URL guard

**Files:**
- Create: `apps/commerce-platform/src/shared-kernel/infrastructure/secret-cipher.ts`, `secret-cipher.spec.ts`
- Create: `apps/commerce-platform/src/shared-kernel/infrastructure/public-url.ts`, `public-url.spec.ts`
- Modify: `apps/commerce-platform/src/modules/platform/scraping/infrastructure/credential-cipher.ts`

**Interfaces:**
- Produces: `secretCipher(envName: string, messages: { missingKey: string; malformed: string; wrongKey: string }): { encrypt(plain: string): string; decrypt(stored: string): string; configured(): boolean }`
- Produces: `class BlockedUrlError extends Error` (message = code: `invalid_url | scheme_not_allowed | dns_failed | blocked_url`), `isBlockedAddress(address: string): boolean`, `type Resolver = (host: string) => Promise<{ address: string }[]>`, `assertPublicHttpUrl(raw: string, resolve?: Resolver): Promise<URL>`

- [ ] **Step 1: Failing specs**

```ts
// apps/commerce-platform/src/shared-kernel/infrastructure/secret-cipher.spec.ts
import { randomBytes } from 'node:crypto';
import { secretCipher } from './secret-cipher';

const messages = { missingKey: 'no key', malformed: 'bad format', wrongKey: 'wrong key' };
const ENV = 'TEST_SECRET_CIPHER_KEY';

describe('secretCipher', () => {
  afterEach(() => { delete process.env[ENV]; });

  it('round-trips and never stores the plain text', () => {
    process.env[ENV] = randomBytes(32).toString('base64');
    const c = secretCipher(ENV, messages);
    const stored = c.encrypt('Bearer abc');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('abc');
    expect(c.decrypt(stored)).toBe('Bearer abc');
    expect(c.configured()).toBe(true);
  });

  it('refuses without a 32-byte key', () => {
    const c = secretCipher(ENV, messages);
    expect(c.configured()).toBe(false);
    expect(() => c.encrypt('x')).toThrow('no key');
  });

  it('tells a malformed value from a changed key', () => {
    process.env[ENV] = randomBytes(32).toString('base64');
    const stored = secretCipher(ENV, messages).encrypt('x');
    expect(() => secretCipher(ENV, messages).decrypt('nope')).toThrow('bad format');
    process.env[ENV] = randomBytes(32).toString('base64');
    expect(() => secretCipher(ENV, messages).decrypt(stored)).toThrow('wrong key');
  });
});
```

```ts
// apps/commerce-platform/src/shared-kernel/infrastructure/public-url.spec.ts
import { assertPublicHttpUrl, isBlockedAddress } from './public-url';

const resolveTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

describe('isBlockedAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip'])(
    'blocks %s', (a) => expect(isBlockedAddress(a)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])('allows %s', (a) => expect(isBlockedAddress(a)).toBe(false));
});

describe('assertPublicHttpUrl', () => {
  it('rejects other schemes', () => expect(assertPublicHttpUrl('file:///etc/passwd', resolveTo('8.8.8.8'))).rejects.toThrow('scheme_not_allowed'));
  it('rejects junk', () => expect(assertPublicHttpUrl('http//x', resolveTo('8.8.8.8'))).rejects.toThrow('invalid_url'));
  it('rejects a literal private IP', () => expect(assertPublicHttpUrl('http://127.0.0.1:8080/x', resolveTo())).rejects.toThrow('blocked_url'));
  it('rejects decimal loopback', () => expect(assertPublicHttpUrl('http://2130706433/', resolveTo())).rejects.toThrow('blocked_url'));
  it('rejects bracketed IPv4-mapped IPv6', () => expect(assertPublicHttpUrl('http://[::ffff:127.0.0.1]/', resolveTo())).rejects.toThrow('blocked_url'));
  it('rejects a name with any private address', () =>
    expect(assertPublicHttpUrl('https://evil.example/h', resolveTo('8.8.8.8', '10.0.0.5'))).rejects.toThrow('blocked_url'));
  it('reports DNS failure', () =>
    expect(assertPublicHttpUrl('https://nope.example', async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow('dns_failed'));
  it('accepts a public name', async () =>
    expect((await assertPublicHttpUrl('https://hooks.example/a?b=1', resolveTo('93.184.216.34'))).host).toBe('hooks.example'));
});
```

- [ ] **Step 2: Run — expect FAIL** (modules not found)

Run: `npx jest -c apps/commerce-platform/jest.config.cts secret-cipher public-url`

- [ ] **Step 3: Implement**

```ts
// apps/commerce-platform/src/shared-kernel/infrastructure/secret-cipher.ts
import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretCipher { encrypt(plain: string): string; decrypt(stored: string): string; configured(): boolean }

/**
 * AES-256-GCM for small secrets at rest, key = env `envName` (32 bytes, base64). Stored as `v1:<iv>:<tag>:<ciphertext>`
 * (base64 parts). Rotating the key means re-entering the secrets. Used by scraping (site passwords) and marketing
 * webhooks (header secrets).
 */
export function secretCipher(envName: string, messages: { missingKey: string; malformed: string; wrongKey: string }): SecretCipher {
  const key = (): Buffer => {
    const raw = process.env[envName]?.trim();
    const value = raw ? Buffer.from(raw, 'base64') : null;
    if (!value || value.length !== 32) throw new BadRequestException(messages.missingKey);
    return value;
  };
  return {
    configured() { try { key(); return true; } catch { return false; } },
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(), iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
    },
    decrypt(stored) {
      const [version, iv, tag, data] = stored.split(':');
      if (version !== 'v1' || !iv || !tag || !data) throw new BadRequestException(messages.malformed);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException(messages.wrongKey);
      }
    },
  };
}
```

Replace the body of `credential-cipher.ts` (keep its doc comment and both exported names):

```ts
import { secretCipher } from '../../../../shared-kernel/infrastructure/secret-cipher';

/** Site passwords at rest: AES-256-GCM, key = SCRAPING_CREDENTIALS_KEY (32 bytes, base64). See secret-cipher.ts. */
const cipher = secretCipher('SCRAPING_CREDENTIALS_KEY', {
  missingKey: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SCRAPING_CREDENTIALS_KEY จึงยังเก็บรหัสผ่านเว็บไม่ได้ — แจ้งทีมระบบ',
  malformed: 'รหัสผ่านเว็บที่เก็บไว้อ่านไม่ได้ กรุณาบันทึกใหม่',
  wrongKey: 'รหัสผ่านเว็บที่เก็บไว้อ่านไม่ได้ (คีย์เปลี่ยน?) กรุณาบันทึกใหม่',
});
export const encryptCredential = (plain: string): string => cipher.encrypt(plain);
export const decryptCredential = (stored: string): string => cipher.decrypt(stored);
```
(The three messages are copied verbatim from the current file — check they match before saving.)

```ts
// apps/commerce-platform/src/shared-kernel/infrastructure/public-url.ts
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Raised with a code as the message: invalid_url | scheme_not_allowed | dns_failed | blocked_url. */
export class BlockedUrlError extends Error {}
export type Resolver = (host: string) => Promise<{ address: string }[]>;

const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fe80::', 10], ['fc00::', 7], ['::ffff:0:0', 96]] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** Loopback / private / link-local / CGNAT / multicast / IPv4-mapped — anything that is not a plain public address. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return address.toLowerCase().startsWith('::ffff:') || blocked.check(address, 'ipv6');
  return true;
}

const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/**
 * SSRF guard for outbound marketing webhooks: http(s) only, and every address the host resolves to must be public.
 * ponytail: fetch resolves the name again after this check (rebinding window of milliseconds); pin the checked
 * address with an undici dispatcher if that window ever matters.
 */
export async function assertPublicHttpUrl(raw: string, resolve: Resolver = systemResolver): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BlockedUrlError('invalid_url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('scheme_not_allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try { addresses = (await resolve(host)).map((a) => a.address); } catch { throw new BlockedUrlError('dns_failed'); }
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new BlockedUrlError('blocked_url');
  return url;
}
```

- [ ] **Step 4: Run — expect PASS, and the scraping spec still passes**

```bash
npx jest -c apps/commerce-platform/jest.config.cts secret-cipher public-url site-login scraping
```

- [ ] **Step 5: Commit**

```bash
git add apps/commerce-platform/src/shared-kernel/infrastructure apps/commerce-platform/src/modules/platform/scraping/infrastructure/credential-cipher.ts
git commit -m "feat(platform): shared secret cipher and public-URL (SSRF) guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: commerce — workflow domain (types, DSL, schedule, template, hashing, validator)

**Files:**
- Create: `libs/marketing-workflow/src/index.d.ts`; Modify: `tsconfig.base.json` (paths)
- Create in `apps/commerce-platform/src/modules/integration/marketing-workflow/domain/`: `workflow.types.ts`, `expression.parser.ts` (copy), `expression.parser.spec.ts` (copy), `expression.evaluator.ts` (copy), `schedule.ts` (copy), `schedule.spec.ts` (copy), `expression.fields.ts`, `template.ts`, `bucket.ts`, `workflow.validator.ts`, `template.spec.ts`, `bucket.spec.ts`, `workflow.validator.spec.ts`
- Modify: `apps/commerce-platform/src/modules/integration/customers/customer-metrics.service.ts` (export `JOSH_ACTIVE_ORDER_STATUSES` if not exported)

**Interfaces (produces):**
- Types in `@cp/marketing-workflow` (below), re-exported by `domain/workflow.types.ts` together with `LIMITS`, `TRIGGER_TYPES`, `NOTIFY_CHANNELS`, `WEBHOOK_METHODS`, `nextIdsOf(step)`.
- `checkExpression(source: string): { ok: true; node: ExpressionNode } | { ok: false; error: string }`, `SUPPORTED_FIELDS`, `FIELD_LABELS`.
- `renderTemplate(text, vars, mode: 'url'|'json'|'header'|'text')`, `webhookVars(customer, ctx, now?)`, `renderWebhook(step, vars) → { method, url, headers, body: string | null }`, `SECRET_REF`, `secretIdsOf(headers)`, `TEMPLATE_VARS`.
- `bucket(key): number` (0–99), `pickBranch(enrollmentId, stepId, branches): SplitBranch | null`.
- `validateWorkflow(input: WorkflowInput): WorkflowIssue[]`.
- From copied josh files: `parseMarketingExpression`, `evaluateMarketingExpression`, `MarketingExpressionContext`, `isScheduledFireDue`, `isWithinMarketingSchedule`, `localDateKey`, `localHour`, `localDow`, `DEFAULT_MARKETING_TIMEZONE`.

- [ ] **Step 1: Shared types (no runtime code)**

```ts
// libs/marketing-workflow/src/index.d.ts
/** Commerce marketing workflow (spec 2026-10-10) — shared by commerce-platform and commerce-admin. Types only. */
export type NotifyChannel = 'push' | 'email' | 'in_app';
export type WebhookMethod = 'POST' | 'PUT' | 'PATCH' | 'GET';
export type WorkflowAction =
  | { kind: 'notify'; channels: NotifyChannel[]; templateKey: string; data?: Record<string, unknown> }
  | { kind: 'grant_coupon'; couponId: string };
export interface SplitBranch { id: string; label: string; percent: number; nextId: string | null }
export interface WebhookHeader { key: string; value: string }
export type WorkflowStep =
  | { id: string; type: 'audience'; segmentIds?: string[]; excludeSegmentIds?: string[]; nextId: string | null }
  | { id: string; type: 'wait'; hours: number; minutes?: number; nextId: string | null }
  | { id: string; type: 'condition'; expression: string; yesNextId: string | null; noNextId: string | null }
  | { id: string; type: 'split'; branches: SplitBranch[] }
  | { id: string; type: 'action'; action: WorkflowAction; nextId: string | null }
  | { id: string; type: 'webhook'; method: WebhookMethod; url: string; headers: WebhookHeader[]; body?: string; nextId: string | null };
export type WorkflowStepType = WorkflowStep['type'];
export type TriggerType = 'scheduled' | 'order_milestone' | 'first_login' | 'app_login';
export interface ScheduledTriggerConfig { time: string; daysOfWeek?: number[]; timezone?: string }
export interface OrderMilestoneTriggerConfig { metric: 'single_order_total' | 'lifetime_spend' | 'lifetime_order_count'; operator: '>=' | '>'; value: number }
export type TriggerConfig = ScheduledTriggerConfig | OrderMilestoneTriggerConfig | Record<string, never>;
export type WorkflowSchedule = {
  timezone: string; daysOfWeek?: number[]; startTime?: string; endTime?: string; activeFrom?: string | null; activeTo?: string | null;
} | null;
export type ExitGoal = { kind: 'order_placed' } | null;
export type WorkflowStatus = 'draft' | 'active' | 'paused';
export interface CanvasPosition { x: number; y: number }
export interface WorkflowInput {
  name: string; triggerType: TriggerType; triggerConfig: TriggerConfig; entryStepId: string | null; steps: WorkflowStep[];
  graphUi: Record<string, CanvasPosition> | null; cooldownDays: number; holdoutPercent: number; conversionWindowDays: number;
  exitOnGoal: ExitGoal; schedule: WorkflowSchedule;
}
export interface WorkflowIssue { stepId: string | null; code: string; message: string }
export interface Workflow extends WorkflowInput {
  id: string; status: WorkflowStatus; activatedAt: string | null; createdBy: string | null; updatedBy: string | null;
  createdAt: string; updatedAt: string; issues: WorkflowIssue[];
}
export interface WorkflowListItem { id: string; name: string; status: WorkflowStatus; triggerType: TriggerType; updatedAt: string; enrolled30d: number; converted30d: number }
export interface WorkflowMeta {
  limits: { maxWaitSteps: number; maxConditionSteps: number; maxAudienceSteps: number; maxWaitMinutes: number; maxHeaders: number; maxBodyBytes: number; minSplitBranches: number; maxSplitBranches: number };
  expressionFields: { field: string; type: 'boolean' | 'number' | 'segment'; label: string }[];
  templateVars: { key: string; label: string }[];
}
export interface SegmentOption { id: string; name: string; memberCount: number | null }
export interface WorkflowRevision { id: string; createdBy: string | null; createdAt: string; snapshot: WorkflowInput }
export interface WorkflowAnalytics {
  counts: { enrolled: number; running: number; completed: number; skipped: number; failed: number; converted: number; holdout: number };
  actions: { kind: string; status: string; count: number }[];
  splits: { stepId: string; branches: { branchId: string; label: string; entered: number; converted: number }[] }[];
  holdout: { enrolled: number; converted: number }; treated: { enrolled: number; converted: number };
}
export interface EnrollmentRow {
  id: string; userId: string; status: string; occurrenceKey: string; currentStepId: string | null; resumeAt: string | null;
  isHoldout: boolean; isTest: boolean; startedAt: string; completedAt: string | null; endReason: string | null; convertedAt: string | null;
}
export interface ActionLogRow { id: string; stepId: string; kind: string; status: string; meta: Record<string, unknown>; createdAt: string }
export interface WebhookSecretItem { id: string; name: string; createdAt: string; updatedAt: string }
export interface WebhookTestResult { status: number | null; body: string; error?: string }
```

In `tsconfig.base.json` `paths`, after `"@cp/growth"`, add `"@cp/marketing-workflow": ["./libs/marketing-workflow/src/index.d.ts"]`.

- [ ] **Step 2: Copy josh's pure DSL + schedule (with their specs)**

```bash
J=/Users/pongpanot_s/Documents/dev/josh; S=apps/backend/src/app/marketing-workflow
D=apps/commerce-platform/src/modules/integration/marketing-workflow/domain; mkdir -p $D
SHA=$(git -C $J rev-parse --short origin/main)
for pair in "marketing-expression.parser:expression.parser" "marketing-expression.parser.spec:expression.parser.spec" \
            "marketing-expression.evaluator:expression.evaluator" "marketing-schedule:schedule" "marketing-schedule.spec:schedule.spec"; do
  src=${pair%%:*}; dst=${pair##*:}
  { echo "// Copied from josh origin/main $SHA $S/$src.ts — keep in sync by hand (phase 3 retires josh's copy)."; git -C $J show origin/main:$S/$src.ts; } > $D/$dst.ts
done
sed -i '' "s#'./marketing-expression.parser'#'./expression.parser'#g" $D/expression.evaluator.ts $D/expression.parser.spec.ts
sed -i '' "s#'./marketing-expression.evaluator'#'./expression.evaluator'#g" $D/expression.parser.spec.ts
sed -i '' "s#import { MarketingWorkflowSchedule } from './marketing-step.types';#import type { WorkflowSchedule as MarketingWorkflowSchedule } from './workflow.types';#" $D/schedule.ts
sed -i '' "s#'./marketing-schedule'#'./schedule'#g" $D/schedule.spec.ts
grep -n "from '\./" $D/*.ts
```
Expected: every remaining relative import points at a file in `$D`. If `schedule.spec.ts` imports something else from josh (e.g. `marketing-step.types`), replace that import with `./workflow.types`. If the josh spec does not exist (`git show` error), delete the empty file.

- [ ] **Step 3: `workflow.types.ts`**

```ts
// apps/commerce-platform/src/modules/integration/marketing-workflow/domain/workflow.types.ts
import type { WorkflowStep } from '@cp/marketing-workflow';
export type {
  CanvasPosition, ExitGoal, NotifyChannel, OrderMilestoneTriggerConfig, ScheduledTriggerConfig, SplitBranch, TriggerConfig,
  TriggerType, WebhookHeader, WebhookMethod, Workflow, WorkflowAction, WorkflowInput, WorkflowIssue, WorkflowSchedule,
  WorkflowStatus, WorkflowStep, WorkflowStepType,
} from '@cp/marketing-workflow';

/** Same numbers as josh's editor / validator (MAX_MARKETING_WAIT_STEPS = 3, MAX_MARKETING_CONDITION_STEPS = 5). */
export const LIMITS = {
  maxWaitSteps: 3, maxConditionSteps: 5, maxAudienceSteps: 1, maxWaitMinutes: 30 * 24 * 60,
  maxHeaders: 20, maxBodyBytes: 16 * 1024, maxUrlLength: 1024, minSplitBranches: 2, maxSplitBranches: 4,
} as const;
export const TRIGGER_TYPES = ['scheduled', 'order_milestone', 'first_login', 'app_login'] as const;
export const NOTIFY_CHANNELS = ['push', 'email', 'in_app'] as const;
export const WEBHOOK_METHODS = ['POST', 'PUT', 'PATCH', 'GET'] as const;

/** Every outgoing pointer of a step, in port order (condition: yes, no · split: branch order). */
export function nextIdsOf(step: WorkflowStep): (string | null)[] {
  if (step.type === 'condition') return [step.yesNextId, step.noNextId];
  if (step.type === 'split') return step.branches.map((b) => b.nextId);
  return [step.nextId];
}
```

- [ ] **Step 4: Failing specs for fields / template / bucket / validator**

```ts
// domain/template.spec.ts
import { renderTemplate, renderWebhook, secretIdsOf, webhookVars } from './template';

const vars = { user_name: 'Nok "the" Boss\r\nX-Evil: 1', user_email: 'a&b@x.co' };
const ctx = { userId: 'u1', workflowId: 'w1', workflowName: 'Welcome', enrollmentId: 'e1', stepId: 's1' };

describe('renderTemplate', () => {
  it('keeps a JSON body valid whatever the value holds', () => {
    const body = renderTemplate('{"name":"{{user_name}}"}', vars, 'json');
    expect(JSON.parse(body).name).toBe(vars.user_name);
  });
  it('cannot inject a header line', () => expect(renderTemplate('{{user_name}}', vars, 'header')).not.toMatch(/[\r\n]/));
  it('encodes values in a URL', () => expect(renderTemplate('https://h.co/?e={{user_email}}', vars, 'url')).toBe('https://h.co/?e=a%26b%40x.co'));
  it('leaves unknown variables and secret refs alone', () =>
    expect(renderTemplate('{{nope}} {{secret:11111111-1111-4111-8111-111111111111}}', vars, 'text'))
      .toBe('{{nope}} {{secret:11111111-1111-4111-8111-111111111111}}'));
});

describe('webhookVars / renderWebhook', () => {
  it('builds josh-style names from the customer copy plus workflow ids', () => {
    const v = webhookVars({ first_name: 'Nok', last_name: 'S', email: 'n@x.co', mobile_phone: '081' }, ctx);
    expect(v).toMatchObject({ user_name: 'Nok S', user_email: 'n@x.co', user_phone: '081', workflow_name: 'Welcome', step_id: 's1' });
  });
  it('renders url / headers / body and treats the body as JSON unless content-type says otherwise', () => {
    const step = { id: 's1', type: 'webhook' as const, method: 'POST' as const, url: 'https://h.co/{{user_email}}',
      headers: [{ key: 'X-Name', value: '{{user_name}}' }, { key: 'Authorization', value: '{{secret:11111111-1111-4111-8111-111111111111}}' }],
      body: '{"n":"{{user_name}}"}', nextId: null };
    const out = renderWebhook(step, vars);
    expect(out.url).toBe('https://h.co/a%26b%40x.co');
    expect(out.headers[0].value).not.toMatch(/[\r\n]/);
    expect(JSON.parse(out.body!).n).toBe(vars.user_name);
    expect(secretIdsOf(out.headers)).toEqual(['11111111-1111-4111-8111-111111111111']);
    const text = renderWebhook({ ...step, headers: [{ key: 'content-type', value: 'text/plain' }] }, vars);
    expect(text.body).toBe(`{"n":"${vars.user_name}"}`);
  });
  it('sends no body for GET', () =>
    expect(renderWebhook({ id: 's', type: 'webhook', method: 'GET', url: 'https://h.co', headers: [], body: 'x', nextId: null }, {}).body).toBeNull());
});
```

```ts
// domain/bucket.spec.ts
import { randomUUID } from 'node:crypto';
import { bucket, pickBranch } from './bucket';

const branches = [{ id: 'a', label: 'A', percent: 20, nextId: null }, { id: 'b', label: 'B', percent: 30, nextId: null }, { id: 'c', label: 'C', percent: 50, nextId: null }];

describe('bucket / pickBranch', () => {
  it('is deterministic', () => {
    const e = randomUUID();
    expect(bucket(e)).toBe(bucket(e));
    expect(pickBranch(e, 's1', branches)).toBe(pickBranch(e, 's1', branches));
  });
  it('splits 10,000 enrollments close to the percents (±2 points)', () => {
    const hits: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10_000; i++) hits[pickBranch(randomUUID(), 's1', branches)!.id]++;
    expect(Math.abs(hits.a / 100 - 20)).toBeLessThanOrEqual(2);
    expect(Math.abs(hits.b / 100 - 30)).toBeLessThanOrEqual(2);
    expect(Math.abs(hits.c / 100 - 50)).toBeLessThanOrEqual(2);
  });
  it('returns null with no branches', () => expect(pickBranch('e', 's', [])).toBeNull());
});
```

```ts
// domain/workflow.validator.spec.ts
import type { WorkflowInput, WorkflowStep } from './workflow.types';
import { validateWorkflow } from './workflow.validator';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (steps: WorkflowStep[], over: Partial<WorkflowInput> = {}): WorkflowInput => ({
  name: 'W', triggerType: 'first_login', triggerConfig: {}, entryStepId: steps[0]?.id ?? null, steps, graphUi: null,
  cooldownDays: 0, holdoutPercent: 0, conversionWindowDays: 7, exitOnGoal: null, schedule: null, ...over,
});
const notify = (n: number, nextId: string | null = null): WorkflowStep =>
  ({ id: id(n), type: 'action', action: { kind: 'notify', channels: ['push'], templateKey: 'custom_a' }, nextId });
const codes = (w: WorkflowInput) => validateWorkflow(w).map((i) => i.code);

describe('validateWorkflow', () => {
  it('accepts a minimal valid flow', () => expect(validateWorkflow(base([notify(1)]))).toEqual([]));
  it('needs an entry and real targets', () => {
    expect(codes(base([notify(1)], { entryStepId: null }))).toContain('no_entry');
    expect(codes(base([notify(1, id(9))]))).toContain('bad_next');
  });
  it('finds cycles', () => expect(codes(base([notify(1, id(2)), notify(2, id(1))]))).toContain('cycle'));
  it('checks split branches', () => {
    const split = (percents: number[]): WorkflowStep => ({ id: id(1), type: 'split', branches: percents.map((p, i) => ({ id: `b${i}`, label: `B${i}`, percent: p, nextId: null })) });
    expect(codes(base([split([50, 50])]))).toEqual([]);
    expect(codes(base([split([60, 50])]))).toContain('split_sum');
    expect(codes(base([split([100])]))).toContain('split_count');
    expect(codes(base([split([50.5, 49.5])]))).toContain('split_percent');
  });
  it('checks webhooks', () => {
    const wh = (over: object): WorkflowStep => ({ id: id(1), type: 'webhook', method: 'POST', url: 'https://h.co', headers: [], nextId: null, ...over } as WorkflowStep);
    expect(codes(base([wh({})]))).toEqual([]);
    expect(codes(base([wh({ url: 'ftp://h.co' })]))).toContain('webhook_url');
    expect(codes(base([wh({ headers: [{ key: 'Bad Key', value: 'x' }] })]))).toContain('webhook_header');
    expect(codes(base([wh({ headers: [{ key: 'A', value: 'x\r\ny' }] })]))).toContain('webhook_header');
    expect(codes(base([wh({ headers: [{ key: 'A', value: 'Bearer {{secret:x}}' }] })]))).toContain('webhook_secret_ref');
    expect(codes(base([wh({ method: 'GET', body: 'x' })]))).toContain('webhook_get_body');
    expect(codes(base([wh({ body: 'x'.repeat(16 * 1024 + 1) })]))).toContain('webhook_body');
  });
  it('limits waits and conditions and rejects phase-2 fields', () => {
    const waits = [1, 2, 3, 4].map((n) => ({ id: id(n), type: 'wait', hours: 1, nextId: n < 4 ? id(n + 1) : null }) as WorkflowStep);
    expect(codes(base(waits))).toContain('too_many_waits');
    const cond: WorkflowStep = { id: id(1), type: 'condition', expression: 'cart.total > 10', yesNextId: null, noNextId: null };
    expect(codes(base([cond]))).toContain('condition_expression');
  });
  it('checks trigger configs', () => {
    expect(codes(base([notify(1)], { triggerType: 'scheduled', triggerConfig: { time: '25:00' } }))).toContain('trigger_config');
    expect(codes(base([notify(1)], { triggerType: 'order_milestone', triggerConfig: { metric: 'lifetime_spend', operator: '>=', value: 1000 } }))).toEqual([]);
  });
});
```

- [ ] **Step 5: Run — expect FAIL** (modules not found); copied specs should already PASS

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow/domain`

- [ ] **Step 6: Implement `expression.fields.ts`, `template.ts`, `bucket.ts`, `workflow.validator.ts`**

```ts
// domain/expression.fields.ts
import { ExpressionNode, MarketingExpressionField, parseMarketingExpression } from './expression.parser';

/** Condition fields commerce can answer in phase 1 (no cart / page-view data yet). */
export const SUPPORTED_FIELDS: MarketingExpressionField[] = ['still_no_order', 'segment.in', 'user.order_count', 'time.in_schedule', 'time.hour', 'time.dow'];
export const FIELD_LABELS: Record<string, string> = {
  still_no_order: 'ยังไม่สั่งซื้อตั้งแต่เข้า workflow', 'segment.in': 'อยู่ใน segment', 'user.order_count': 'จำนวนออเดอร์ทั้งหมด',
  'time.in_schedule': 'อยู่ในช่วงเวลาทำงาน', 'time.hour': 'ชั่วโมง (0–23)', 'time.dow': 'วันในสัปดาห์ (0=อา)',
};

const fieldsOf = (node: ExpressionNode): MarketingExpressionField[] =>
  node.type === 'comparison' ? [node.field] : [...fieldsOf(node.left), ...fieldsOf(node.right)];

export function checkExpression(source: string): { ok: true; node: ExpressionNode } | { ok: false; error: string } {
  let node: ExpressionNode;
  try { node = parseMarketingExpression(source); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const unsupported = [...new Set(fieldsOf(node).filter((f) => !SUPPORTED_FIELDS.includes(f)))];
  if (unsupported.length) return { ok: false, error: `ใช้ได้ในเฟส 2: ${unsupported.join(', ')}` };
  return { ok: true, node };
}
```

```ts
// domain/template.ts
import type { WebhookHeader, WebhookMethod, WorkflowStep } from './workflow.types';

const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g;
/** A header value that is exactly a secret reference; the sender swaps in the stored value. */
export const SECRET_REF = /^\{\{secret:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}\}$/i;
export type RenderMode = 'url' | 'json' | 'header' | 'text';

/** josh's `{{name}}` syntax; unknown names stay visible so typos show up in tests. Escapes for where it lands. */
export function renderTemplate(text: string, vars: Record<string, string>, mode: RenderMode): string {
  return text.replace(VAR_RE, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) return match;
    if (mode === 'url') return encodeURIComponent(value);
    if (mode === 'json') return JSON.stringify(value).slice(1, -1);
    if (mode === 'header') return value.replace(/[\r\n]+/g, ' ');
    return value;
  });
}

export const TEMPLATE_VARS = [
  { key: 'user_name', label: 'ชื่อลูกค้า' }, { key: 'user_first_name', label: 'ชื่อจริงลูกค้า' }, { key: 'user_last_name', label: 'นามสกุลลูกค้า' },
  { key: 'user_email', label: 'อีเมลลูกค้า' }, { key: 'user_phone', label: 'เบอร์โทรลูกค้า' }, { key: 'user_custype', label: 'ประเภทลูกค้า (custype)' },
  { key: 'cuisine_name', label: 'ประเภทร้าน (Cuisine)' }, { key: 'today', label: 'วันที่วันนี้' }, { key: 'user_id', label: 'รหัสลูกค้า' },
  { key: 'workflow_id', label: 'รหัส workflow' }, { key: 'workflow_name', label: 'ชื่อ workflow' }, { key: 'enrollment_id', label: 'รหัสการเข้า workflow' },
  { key: 'step_id', label: 'รหัส step' },
] as const;

export interface VarContext { userId: string; workflowId: string; workflowName: string; enrollmentId: string; stepId: string }

/** Variables from the josh customer copy (`josh_customers.data`) plus workflow ids. */
export function webhookVars(customer: Record<string, unknown> | null, ctx: VarContext, now = new Date()): Record<string, string> {
  const s = (k: string) => (typeof customer?.[k] === 'string' ? (customer[k] as string).trim() : '');
  const first = s('first_name'); const last = s('last_name');
  return {
    user_id: ctx.userId, user_name: [first, last].filter(Boolean).join(' ') || s('nickname'), user_first_name: first, user_last_name: last,
    user_email: s('email'), user_phone: s('mobile_phone'), user_custype: s('custype'), cuisine_name: s('cuisine_name'),
    today: now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' }),
    workflow_id: ctx.workflowId, workflow_name: ctx.workflowName, enrollment_id: ctx.enrollmentId, step_id: ctx.stepId,
  };
}

export interface RenderedWebhook { method: WebhookMethod; url: string; headers: WebhookHeader[]; body: string | null }

export function renderWebhook(step: Extract<WorkflowStep, { type: 'webhook' }>, vars: Record<string, string>): RenderedWebhook {
  const contentType = step.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
  const bodyMode: RenderMode = !contentType || /json/i.test(contentType) ? 'json' : 'text';
  return {
    method: step.method,
    url: renderTemplate(step.url, vars, 'url'),
    headers: step.headers.map((h) => ({ key: h.key, value: SECRET_REF.test(h.value) ? h.value : renderTemplate(h.value, vars, 'header') })),
    body: step.method === 'GET' || !step.body ? null : renderTemplate(step.body, vars, bodyMode),
  };
}

export const secretIdsOf = (headers: WebhookHeader[]): string[] =>
  headers.map((h) => SECRET_REF.exec(h.value)?.[1]).filter((v): v is string => !!v);
```

```ts
// domain/bucket.ts
import { createHash } from 'node:crypto';
import type { SplitBranch } from './workflow.types';

/** Stable 0–99 from any key (sha256, first 4 bytes). */
export const bucket = (key: string): number => createHash('sha256').update(key).digest().readUInt32BE(0) % 100;

/** A/B split: the same enrollment + step always lands in the same branch. */
export function pickBranch(enrollmentId: string, stepId: string, branches: SplitBranch[]): SplitBranch | null {
  const b = bucket(`${enrollmentId}:${stepId}`);
  let acc = 0;
  for (const branch of branches) { acc += branch.percent; if (b < acc) return branch; }
  return branches[branches.length - 1] ?? null;
}
```

```ts
// domain/workflow.validator.ts
import { checkExpression } from './expression.fields';
import { SECRET_REF } from './template';
import { LIMITS, NOTIFY_CHANNELS, nextIdsOf, WEBHOOK_METHODS } from './workflow.types';
import type { WorkflowInput, WorkflowIssue, WorkflowStep } from './workflow.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const TEMPLATE_KEY = /^[A-Za-z0-9_.-]{1,100}$/;
const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** Everything that blocks activation (a draft may be saved with issues). Messages are shown to staff. */
export function validateWorkflow(w: WorkflowInput): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const add = (stepId: string | null, code: string, message: string) => issues.push({ stepId, code, message });

  if (!w.name?.trim() || w.name.length > 200) add(null, 'name', 'ตั้งชื่อ workflow (ไม่เกิน 200 ตัวอักษร)');
  if (!isInt(w.cooldownDays, 0, 365)) add(null, 'cooldown', 'cooldown ต้องเป็น 0–365 วัน');
  if (!isInt(w.holdoutPercent, 0, 50)) add(null, 'holdout', 'holdout ต้องเป็น 0–50%');
  if (!isInt(w.conversionWindowDays, 1, 90)) add(null, 'conversion_window', 'ช่วงวัด conversion ต้องเป็น 1–90 วัน');
  validateTrigger(w, add);

  const ids = new Set<string>();
  for (const s of w.steps) {
    if (!UUID.test(s.id)) add(s.id, 'bad_id', 'รหัส step ไม่ถูกต้อง');
    if (ids.has(s.id)) add(s.id, 'duplicate_id', 'รหัส step ซ้ำ');
    ids.add(s.id);
  }
  if (!w.entryStepId) add(null, 'no_entry', 'ยังไม่ได้ต่อ Entry เข้ากับ step แรก');
  else if (!ids.has(w.entryStepId)) add(null, 'bad_entry', 'Entry ชี้ไปที่ step ที่ไม่มีอยู่');
  for (const s of w.steps) if (nextIdsOf(s).some((n) => n !== null && !ids.has(n))) add(s.id, 'bad_next', 'เส้นทางชี้ไปที่ step ที่ไม่มีอยู่');
  if (hasCycle(w.steps)) add(null, 'cycle', 'flow วนกลับมาที่เดิม');

  const count = (t: WorkflowStep['type']) => w.steps.filter((s) => s.type === t).length;
  if (count('audience') > LIMITS.maxAudienceSteps) add(null, 'too_many_audiences', 'มี Audience filter ได้ 1 อัน');
  if (count('wait') > LIMITS.maxWaitSteps) add(null, 'too_many_waits', `มี Time Delay ได้ไม่เกิน ${LIMITS.maxWaitSteps} อัน`);
  if (count('condition') > LIMITS.maxConditionSteps) add(null, 'too_many_conditions', `มี Condition ได้ไม่เกิน ${LIMITS.maxConditionSteps} อัน`);

  for (const s of w.steps) validateStep(s, (code, message) => add(s.id, code, message));
  return issues;
}

function validateTrigger(w: WorkflowInput, add: (stepId: string | null, code: string, message: string) => void) {
  const c = (w.triggerConfig ?? {}) as Record<string, unknown>;
  if (w.triggerType === 'scheduled') {
    const days = c.daysOfWeek;
    if (typeof c.time !== 'string' || !HHMM.test(c.time) || (days !== undefined && (!Array.isArray(days) || !days.every((d) => isInt(d, 0, 6)))))
      add(null, 'trigger_config', 'ตั้งเวลา (HH:mm) และวันให้ถูกต้อง');
  } else if (w.triggerType === 'order_milestone') {
    if (!['single_order_total', 'lifetime_spend', 'lifetime_order_count'].includes(c.metric as string) || !['>=', '>'].includes(c.operator as string)
      || typeof c.value !== 'number' || !(c.value > 0)) add(null, 'trigger_config', 'ตั้งเงื่อนไขยอดสั่งซื้อให้ครบ');
  } else if (w.triggerType !== 'first_login' && w.triggerType !== 'app_login') add(null, 'trigger_type', 'ประเภท trigger นี้ยังไม่รองรับ');
}

function validateStep(s: WorkflowStep, add: (code: string, message: string) => void) {
  switch (s.type) {
    case 'audience':
      if (![...(s.segmentIds ?? []), ...(s.excludeSegmentIds ?? [])].every((x) => UUID.test(x))) add('audience_segment', 'segment ไม่ถูกต้อง');
      return;
    case 'wait': {
      const total = (s.hours ?? 0) * 60 + (s.minutes ?? 0);
      if (!isInt(s.hours, 0, LIMITS.maxWaitMinutes) || !isInt(s.minutes ?? 0, 0, 59) || total < 1 || total > LIMITS.maxWaitMinutes)
        add('wait_duration', 'รอได้ 1 นาที ถึง 30 วัน');
      return;
    }
    case 'condition': {
      const r = checkExpression(s.expression ?? '');
      if (!r.ok) add('condition_expression', r.error);
      return;
    }
    case 'split': {
      if (s.branches.length < LIMITS.minSplitBranches || s.branches.length > LIMITS.maxSplitBranches) add('split_count', 'A/B Split มีได้ 2–4 กิ่ง');
      if (!s.branches.every((b) => isInt(b.percent, 1, 99))) add('split_percent', 'สัดส่วนแต่ละกิ่งต้องเป็นจำนวนเต็ม 1–99');
      if (s.branches.reduce((a, b) => a + (b.percent ?? 0), 0) !== 100) add('split_sum', 'สัดส่วนรวมต้องเท่ากับ 100%');
      if (new Set(s.branches.map((b) => b.id)).size !== s.branches.length || s.branches.some((b) => !b.id || !b.label?.trim() || b.label.length > 40))
        add('split_branch', 'แต่ละกิ่งต้องมีชื่อ (ไม่เกิน 40 ตัวอักษร) และไม่ซ้ำกัน');
      return;
    }
    case 'action':
      if (s.action.kind === 'notify') {
        if (!TEMPLATE_KEY.test(s.action.templateKey ?? '')) add('notify_template', 'เลือก template ข้อความ');
        if (!s.action.channels?.length || new Set(s.action.channels).size !== s.action.channels.length
          || !s.action.channels.every((c) => (NOTIFY_CHANNELS as readonly string[]).includes(c))) add('notify_channels', 'เลือกช่องทางส่งอย่างน้อย 1 ช่องทาง');
      } else if (!UUID.test(s.action.couponId ?? '')) add('coupon', 'เลือกคูปอง');
      return;
    case 'webhook': {
      if (!(WEBHOOK_METHODS as readonly string[]).includes(s.method)) add('webhook_method', 'method ไม่ถูกต้อง');
      if (!/^https?:\/\//i.test(s.url ?? '') || s.url.length > LIMITS.maxUrlLength) add('webhook_url', 'URL ต้องขึ้นต้นด้วย http:// หรือ https:// และยาวไม่เกิน 1024');
      if (s.headers.length > LIMITS.maxHeaders || s.headers.some((h) => !TOKEN.test(h.key) || /[\r\n]/.test(h.value) || h.value.length > 2000))
        add('webhook_header', 'header ไม่ถูกต้อง (ไม่เกิน 20 แถว, ชื่อไม่มีช่องว่าง)');
      if (s.headers.some((h) => h.value.includes('{{secret:') && !SECRET_REF.test(h.value))) add('webhook_secret_ref', 'ค่าลับต้องเป็นค่าทั้งช่อง');
      if (s.method === 'GET' && s.body) add('webhook_get_body', 'GET ส่ง body ไม่ได้');
      if (s.body && Buffer.byteLength(s.body, 'utf8') > LIMITS.maxBodyBytes) add('webhook_body', 'body ยาวเกิน 16 KB');
      return;
    }
  }
}

function hasCycle(steps: WorkflowStep[]): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const s = byId.get(id);
    if (s) for (const n of nextIdsOf(s)) if (n && visit(n)) return true;
    state.set(id, 2);
    return false;
  };
  return steps.some((s) => visit(s.id));
}
```

Also in `customer-metrics.service.ts`: if `JOSH_ACTIVE_ORDER_STATUSES` is a plain `const`, change it to `export const` (no other change).

- [ ] **Step 7: Run — expect PASS**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow/domain customer-metrics`

- [ ] **Step 8: Commit**

```bash
git add libs/marketing-workflow tsconfig.base.json apps/commerce-platform/src/modules/integration/marketing-workflow/domain apps/commerce-platform/src/modules/integration/customers/customer-metrics.service.ts
git commit -m "feat(marketing-workflow): domain — types, josh DSL/schedule copy, template escaping, A/B bucket, validator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: commerce — migration, entities, per-user segment match

**Files:**
- Create: `apps/commerce-platform/src/migrations/1796300000000-CommerceMarketingWorkflows.ts`
- Create: `.../marketing-workflow/infrastructure/marketing-workflow.entity.ts`, `marketing-workflow-revision.entity.ts`, `marketing-webhook-secret.entity.ts`
- Modify: `.../webhook-subscription/infrastructure/webhook-delivery.entity.ts`, `.../webhook-subscription/application/webhook-delivery.worker.ts`
- Modify: `.../segments/segments.service.ts`; Test: `.../segments/segments.user-match.spec.ts`

**Interfaces (produces):**
- Entities `MarketingWorkflowRow` (table `marketing_workflows`, camelCase props as in the `WorkflowInput` type + `id, status, activatedAt, lastScheduledKey, createdBy, updatedBy, createdAt, updatedAt`), `MarketingWorkflowRevisionRow` (`id, workflowId, snapshot, createdBy, createdAt`), `MarketingWebhookSecret` (`id, name, valueEncrypted, createdBy, createdAt, updatedAt`).
- `WebhookDelivery` gains `kind: 'event' | 'marketing'`, `method: string | null`, `headers: WebhookHeader[] | null`, `idempotencyKey: string | null`; `subscriptionId: string | null`.
- `SegmentsService.userMatchesSegment(segmentId: string, userId: string, m?: EntityManager): Promise<boolean>`; `SegmentsService.evaluableSegments(): Promise<SegmentOption[]>`.

- [ ] **Step 1: Migration**

```ts
// apps/commerce-platform/src/migrations/1796300000000-CommerceMarketingWorkflows.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Commerce-run marketing workflows, phase 1 (spec 2026-10-10 §3.1, §4.4). */
export class CommerceMarketingWorkflows1796300000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE marketing_workflows (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar(200) NOT NULL, status varchar(16) NOT NULL DEFAULT 'draft',
      trigger_type varchar(32) NOT NULL, trigger_config jsonb NOT NULL DEFAULT '{}', entry_step_id varchar(64),
      steps jsonb NOT NULL DEFAULT '[]', graph_ui jsonb, cooldown_days int NOT NULL DEFAULT 0, holdout_percent int NOT NULL DEFAULT 0,
      conversion_window_days int NOT NULL DEFAULT 7, exit_on_goal jsonb, schedule jsonb, activated_at timestamptz,
      last_scheduled_key varchar(16), created_by varchar(128), updated_by varchar(128),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT marketing_workflows_status CHECK (status IN ('draft', 'active', 'paused')))`);
    await q.query(`CREATE INDEX marketing_workflows_active ON marketing_workflows (trigger_type) WHERE status = 'active'`);
    await q.query(`CREATE TABLE marketing_workflow_revisions (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workflow_id uuid NOT NULL REFERENCES marketing_workflows(id) ON DELETE CASCADE,
      snapshot jsonb NOT NULL, created_by varchar(128), created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX marketing_workflow_revisions_wf ON marketing_workflow_revisions (workflow_id, created_at DESC)`);
    await q.query(`CREATE TABLE marketing_workflow_enrollments (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workflow_id uuid NOT NULL REFERENCES marketing_workflows(id) ON DELETE CASCADE,
      user_id uuid NOT NULL, occurrence_key varchar(64) NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending',
      current_step_id varchar(64), resume_at timestamptz, is_holdout boolean NOT NULL DEFAULT false, is_test boolean NOT NULL DEFAULT false,
      skip_waits boolean NOT NULL DEFAULT false, split_assignments jsonb NOT NULL DEFAULT '{}', started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz, end_reason varchar(64), converted_at timestamptz,
      CONSTRAINT marketing_workflow_enrollments_once UNIQUE (workflow_id, user_id, occurrence_key),
      CONSTRAINT marketing_workflow_enrollments_status CHECK (status IN ('pending', 'running', 'completed', 'skipped', 'failed')))`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_due ON marketing_workflow_enrollments (resume_at) WHERE status = 'running'`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_pending ON marketing_workflow_enrollments (started_at) WHERE status = 'pending'`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_user ON marketing_workflow_enrollments (user_id, started_at DESC)`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_wf ON marketing_workflow_enrollments (workflow_id, started_at DESC)`);
    await q.query(`CREATE TABLE marketing_workflow_action_logs (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), enrollment_id uuid NOT NULL REFERENCES marketing_workflow_enrollments(id) ON DELETE CASCADE,
      step_id varchar(64) NOT NULL, kind varchar(16) NOT NULL, status varchar(16) NOT NULL, meta jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX marketing_workflow_action_logs_enrollment ON marketing_workflow_action_logs (enrollment_id, created_at)`);
    await q.query(`CREATE INDEX marketing_workflow_action_logs_kind ON marketing_workflow_action_logs (kind, created_at)`);
    await q.query(`CREATE TABLE marketing_webhook_secrets (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar(128) NOT NULL, value_encrypted text NOT NULL, created_by varchar(128),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`ALTER TABLE webhook_deliveries ALTER COLUMN subscription_id DROP NOT NULL,
      ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'event', ADD COLUMN method varchar(8), ADD COLUMN headers jsonb,
      ADD COLUMN idempotency_key varchar(191)`);
    await q.query(`CREATE UNIQUE INDEX webhook_deliveries_idempotency ON webhook_deliveries (idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await q.query(`CREATE INDEX webhook_deliveries_marketing_pending ON webhook_deliveries (updated_at) WHERE kind = 'marketing' AND status = 'pending'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM webhook_deliveries WHERE kind = 'marketing'`);
    await q.query(`DROP INDEX webhook_deliveries_marketing_pending`);
    await q.query(`DROP INDEX webhook_deliveries_idempotency`);
    await q.query(`ALTER TABLE webhook_deliveries DROP COLUMN idempotency_key, DROP COLUMN headers, DROP COLUMN method, DROP COLUMN kind,
      ALTER COLUMN subscription_id SET NOT NULL`);
    await q.query(`DROP TABLE marketing_webhook_secrets`);
    await q.query(`DROP TABLE marketing_workflow_action_logs`);
    await q.query(`DROP TABLE marketing_workflow_enrollments`);
    await q.query(`DROP TABLE marketing_workflow_revisions`);
    await q.query(`DROP TABLE marketing_workflows`);
  }
}
```

- [ ] **Step 2: Entities**

```ts
// infrastructure/marketing-workflow.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { CanvasPosition, ExitGoal, TriggerConfig, TriggerType, WorkflowSchedule, WorkflowStatus, WorkflowStep } from '../domain/workflow.types';

/** A commerce-run marketing workflow (spec 2026-10-10 §3). Field names follow josh's marketing_workflows for the phase-3 move. */
@Entity('marketing_workflows')
export class MarketingWorkflowRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'varchar', length: 16, default: 'draft' }) status: WorkflowStatus;
  @Column({ name: 'trigger_type', type: 'varchar', length: 32 }) triggerType: TriggerType;
  @Column({ name: 'trigger_config', type: 'jsonb', default: () => "'{}'" }) triggerConfig: TriggerConfig;
  @Column({ name: 'entry_step_id', type: 'varchar', length: 64, nullable: true }) entryStepId: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) steps: WorkflowStep[];
  @Column({ name: 'graph_ui', type: 'jsonb', nullable: true }) graphUi: Record<string, CanvasPosition> | null;
  @Column({ name: 'cooldown_days', type: 'int', default: 0 }) cooldownDays: number;
  @Column({ name: 'holdout_percent', type: 'int', default: 0 }) holdoutPercent: number;
  @Column({ name: 'conversion_window_days', type: 'int', default: 7 }) conversionWindowDays: number;
  @Column({ name: 'exit_on_goal', type: 'jsonb', nullable: true }) exitOnGoal: ExitGoal;
  @Column({ type: 'jsonb', nullable: true }) schedule: WorkflowSchedule;
  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true }) activatedAt: Date | null;
  /** Local date of the last scheduled run that enrolled its whole audience. */
  @Column({ name: 'last_scheduled_key', type: 'varchar', length: 16, nullable: true }) lastScheduledKey: string | null;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @Column({ name: 'updated_by', type: 'varchar', length: 128, nullable: true }) updatedBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

```ts
// infrastructure/marketing-workflow-revision.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { WorkflowInput } from '../domain/workflow.types';

@Entity('marketing_workflow_revisions')
export class MarketingWorkflowRevisionRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workflow_id', type: 'uuid' }) workflowId: string;
  @Column({ type: 'jsonb' }) snapshot: WorkflowInput;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
```

```ts
// infrastructure/marketing-webhook-secret.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** A webhook header value kept out of the workflow JSON (spec §4.6); the plain value is never returned by any API. */
@Entity('marketing_webhook_secrets')
export class MarketingWebhookSecret {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 128 }) name: string;
  @Column({ name: 'value_encrypted', type: 'text' }) valueEncrypted: string;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

In `webhook-delivery.entity.ts`: make `subscriptionId` `@Column({ type: 'uuid', name: 'subscription_id', nullable: true }) subscriptionId: string | null;` and add

```ts
  /** event = a subscription delivery · marketing = a marketing workflow webhook step (own queue, no subscription). */
  @Column({ type: 'varchar', length: 16, default: 'event' })
  kind: 'event' | 'marketing';

  @Column({ type: 'varchar', length: 8, nullable: true })
  method: string | null;

  /** Marketing only, secret refs NOT resolved (resolved at send time). */
  @Column({ type: 'jsonb', nullable: true })
  headers: { key: string; value: string }[] | null;

  @Column({ type: 'varchar', length: 191, name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;
```

In `webhook-delivery.worker.ts` `handle()`, right after the `if (!delivery) throw …` line add:

```ts
    // Marketing webhook rows have their own queue/worker (marketing-workflow module); never send them from here.
    if (delivery.kind !== 'event' || !delivery.subscriptionId) return;
```
Fix any type error from `subscriptionId` now being nullable (e.g. `findOne({ where: { id: delivery.subscriptionId } })` is fine after the guard; `webhook-dispatcher.ts` assigns a string).

- [ ] **Step 3: Failing spec for `userMatchesSegment`**

```ts
// apps/commerce-platform/src/modules/integration/segments/segments.user-match.spec.ts
import { SegmentsService } from './segments.service';
import { UserSegmentRuleType } from './rule-type.enum';

const U = '11111111-1111-4111-8111-111111111111';
function setup(segment: Record<string, unknown> | null, rows: unknown[] = [{ ok: 1 }]) {
  const calls: [string, unknown[]][] = [];
  const m = {
    getRepository: () => ({ findOneBy: jest.fn(async () => segment) }),
    query: jest.fn(async (sql: string, params: unknown[]) => { calls.push([sql, params]); return rows; }),
  };
  const compiler = { compile: jest.fn(() => ({ where: 'm.order_count >= $1', params: [3] })) };
  const svc = new SegmentsService({ manager: m } as never, {} as never, compiler as never);
  return { svc, m, calls };
}
const seg = (over: object) => ({ id: 's1', is_active: true, frozen_at: null, definition: null, rule_type: UserSegmentRuleType.MANUAL_USER_LIST, rule_config: {}, ...over });

describe('SegmentsService.userMatchesSegment', () => {
  it('checks frozen members', async () => {
    const { svc, calls } = setup(seg({ frozen_at: new Date(), definition: { any: 1 } }));
    await expect(svc.userMatchesSegment('s1', U)).resolves.toBe(true);
    expect(calls[0][0]).toContain('segment_members');
  });
  it('compiles a live definition and pins the user as the last parameter', async () => {
    const { svc, calls } = setup(seg({ definition: { any: 1 } }));
    await svc.userMatchesSegment('s1', U);
    expect(calls[0][0]).toContain('AND u.id = $2');
    expect(calls[0][1]).toEqual([3, U]);
  });
  it('is false for rules commerce cannot evaluate, inactive or missing segments', async () => {
    await expect(setup(seg({ rule_type: UserSegmentRuleType.GUEST })).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
    await expect(setup(seg({ is_active: false, definition: {} })).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
    await expect(setup(null).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
  });
  it('matches a manual list only for customers that exist', async () => {
    const { svc } = setup(seg({ rule_config: { user_ids: [U] } }), [{ ok: 1 }]);
    await expect(svc.userMatchesSegment('s1', U)).resolves.toBe(true);
    await expect(setup(seg({ rule_config: { user_ids: [] } })).svc.userMatchesSegment('s1', U)).resolves.toBe(false);
  });
});
```

- [ ] **Step 4: Run — expect FAIL** (`userMatchesSegment is not a function`)

Run: `npx jest -c apps/commerce-platform/jest.config.cts segments.user-match`

- [ ] **Step 5: Implement in `segments.service.ts`** (inside the class, after `findAll`)

```ts
  /**
   * One customer against one segment, for commerce-run marketing workflows: frozen → its members; otherwise the
   * compiled rule over SEGMENT_BASE_FROM. Rules only josh can match (live / device-level) → false.
   */
  async userMatchesSegment(segmentId: string, userId: string, m: EntityManager = this.db.manager): Promise<boolean> {
    const segment = await m.getRepository(Segment).findOneBy({ id: segmentId });
    if (!segment || !segment.is_active || isLiveSegment(segment)) return false;
    if (segment.frozen_at) {
      return (await m.query(`SELECT 1 AS ok FROM segment_members WHERE segment_id = $1 AND user_id = $2 LIMIT 1`, [segmentId, userId])).length > 0;
    }
    if (!segment.definition && segment.rule_type === UserSegmentRuleType.MANUAL_USER_LIST) {
      const raw = segment.rule_config?.user_ids;
      if (!Array.isArray(raw) || !raw.includes(userId)) return false;
      return (await m.query(`SELECT 1 AS ok FROM segment_customers WHERE id = $1`, [userId])).length > 0;
    }
    const { where, params } = segment.definition
      ? this.compiler.compile(segment.definition as unknown as SegmentDefinition)
      : compileLegacyRule(segment.rule_type as UserSegmentRuleType, segment.rule_config);
    return (await m.query(`SELECT 1 AS ok ${SEGMENT_BASE_FROM} WHERE (${where}) AND u.id = $${params.length + 1} LIMIT 1`, [...params, userId])).length > 0;
  }

  /** Segments a commerce workflow may use as an audience (active, evaluable here). */
  async evaluableSegments(): Promise<{ id: string; name: string; memberCount: number | null }[]> {
    const rows = await this.db.getRepository(Segment).find({ where: { is_active: true }, order: { priority: 'DESC', name: 'ASC' } });
    return rows.filter((s) => !isLiveSegment(s)).map((s) => ({ id: s.id, name: s.name, memberCount: s.member_count }));
  }
```
Check the `segment_members` column names in `migrations/1794300000000-CustomerMarketing.ts:22`; if the member column is not `user_id`, use the real name.

- [ ] **Step 6: Run — expect PASS; typecheck**

```bash
npx jest -c apps/commerce-platform/jest.config.cts segments webhook-delivery
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
```

- [ ] **Step 7: Migration against a local DB (if one is configured)**

Run: `npm run migration:run` then `psql "$DATABASE_URL" -c '\d marketing_workflow_enrollments'`. Expected: the table with the unique constraint. Then revert once and re-run to prove `down()`: `npx typeorm migration:revert -d apps/commerce-platform/src/config/data-source.ts` (use the exact revert script from root `package.json` if one exists) and `npm run migration:run`. If no local DB is available, note "migration not run locally" in the task report.

- [ ] **Step 8: Commit**

```bash
git add apps/commerce-platform/src/migrations/1796300000000-CommerceMarketingWorkflows.ts apps/commerce-platform/src/modules/integration/marketing-workflow/infrastructure apps/commerce-platform/src/modules/integration/webhook-subscription apps/commerce-platform/src/modules/integration/segments
git commit -m "feat(marketing-workflow): tables, entities, marketing rows on webhook_deliveries, per-user segment match

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: commerce — webhook sender, worker, secrets

**Files:**
- Modify: `apps/commerce-platform/src/config/redis.config.ts`
- Create: `.../marketing-workflow/application/webhook-send.ts`, `webhook-secrets.service.ts`, `marketing-webhook.worker.ts`
- Test: `.../application/webhook-send.spec.ts`, `webhook-secrets.service.spec.ts`, `marketing-webhook.worker.spec.ts`

**Interfaces:**
- Consumes: `assertPublicHttpUrl`, `BlockedUrlError`, `Resolver` (Task 2); `secretCipher` (Task 2); `SECRET_REF`, `secretIdsOf` (Task 3); `WebhookDelivery` (Task 4).
- Produces: `QUEUES.MARKETING = 'marketing-workflow'`, `QUEUES.MARKETING_WEBHOOK = 'marketing-webhook'`; `MARKETING_WEBHOOK_MAX_ATTEMPTS = 20`; `class WebhookSendError extends Error { code; retryable; status }`; `sendWebhook(req: { method; url; headers; body: string | null; deliveryId?: string }, secrets: Map<string, string>, opts?: { fetchImpl?; resolve?; timeoutMs? }): Promise<{ status: number; body: string }>`; `WebhookSecretsService { configured(); list(); create(name, value, actor); replace(id, value); remove(id); resolve(ids): Promise<Map<string,string>> }`; `MarketingWebhookWorker.handle(deliveryId)`.

- [ ] **Step 1: Queues** — in `QUEUES` add `MARKETING: 'marketing-workflow',` and `MARKETING_WEBHOOK: 'marketing-webhook',`.

- [ ] **Step 2: Failing specs**

```ts
// application/webhook-send.spec.ts
import { sendWebhook, WebhookSendError } from './webhook-send';

const SID = '11111111-1111-4111-8111-111111111111';
const pub = async () => [{ address: '93.184.216.34' }];
const res = (status: number, body = 'ok') => ({ status, ok: status >= 200 && status < 300, text: async () => body }) as unknown as Response;
const req = { method: 'POST' as const, url: 'https://hooks.example/a', headers: [{ key: 'Authorization', value: `{{secret:${SID}}}` }], body: '{"a":1}', deliveryId: 'd1' };

describe('sendWebhook', () => {
  it('swaps in the secret, adds JSON content-type and the delivery id, never follows redirects', async () => {
    const fetchImpl = jest.fn(async () => res(200, 'fine'));
    await expect(sendWebhook(req, new Map([[SID, 'Bearer s3cr3t']]), { fetchImpl, resolve: pub })).resolves.toEqual({ status: 200, body: 'fine' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer s3cr3t', 'Content-Type': 'application/json', 'x-delivery-id': 'd1' });
    expect(init.redirect).toBe('manual');
  });
  it('fails without retry on a missing secret, a blocked URL, a redirect or a 4xx', async () => {
    const f = jest.fn(async () => res(200));
    await expect(sendWebhook(req, new Map(), { fetchImpl: f, resolve: pub })).rejects.toMatchObject({ code: 'secret_missing', retryable: false });
    await expect(sendWebhook({ ...req, url: 'http://10.0.0.1/' }, new Map([[SID, 'x']]), { fetchImpl: f })).rejects.toMatchObject({ code: 'blocked_url', retryable: false });
    await expect(sendWebhook(req, new Map([[SID, 'x']]), { fetchImpl: async () => res(302), resolve: pub })).rejects.toMatchObject({ code: 'redirect_not_followed' });
    await expect(sendWebhook(req, new Map([[SID, 'x']]), { fetchImpl: async () => res(404), resolve: pub })).rejects.toMatchObject({ code: 'http_404', retryable: false });
    expect(f).not.toHaveBeenCalled();
  });
  it('retries 5xx / 429 / network errors, and the error never contains the secret', async () => {
    const e1 = await sendWebhook(req, new Map([[SID, 'Bearer s3cr3t']]), { fetchImpl: async () => res(503), resolve: pub }).catch((e) => e);
    expect(e1).toBeInstanceOf(WebhookSendError);
    expect(e1).toMatchObject({ code: 'http_503', retryable: true, status: 503 });
    const e2 = await sendWebhook(req, new Map([[SID, 'Bearer s3cr3t']]), { fetchImpl: async () => { throw new Error('ECONNRESET Bearer s3cr3t'); }, resolve: pub }).catch((e) => e);
    expect(e2).toMatchObject({ code: 'network_error', retryable: true });
    expect(JSON.stringify(e2) + String(e2.message)).not.toContain('s3cr3t');
  });
  it('sends no body for GET', async () => {
    const fetchImpl = jest.fn(async () => res(200));
    await sendWebhook({ ...req, method: 'GET', headers: [] }, new Map(), { fetchImpl, resolve: pub });
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBeUndefined();
  });
});
```

```ts
// application/webhook-secrets.service.spec.ts
import { randomBytes } from 'node:crypto';
import { WebhookSecretsService } from './webhook-secrets.service';

function setup() {
  const rows: Record<string, unknown>[] = [];
  const repo = {
    save: jest.fn(async (r: Record<string, unknown>) => { const row = { id: 'id1', createdAt: new Date(), updatedAt: new Date(), ...r }; rows.push(row); return row; }),
    find: jest.fn(async () => rows), findBy: jest.fn(async () => rows), findOneBy: jest.fn(async () => rows[0] ?? null), delete: jest.fn(),
  };
  return { svc: new WebhookSecretsService(repo as never), repo, rows };
}

describe('WebhookSecretsService', () => {
  beforeEach(() => { process.env.MARKETING_WEBHOOK_SECRETS_KEY = randomBytes(32).toString('base64'); });
  afterEach(() => { delete process.env.MARKETING_WEBHOOK_SECRETS_KEY; });

  it('stores only ciphertext and never returns the value', async () => {
    const { svc, rows } = setup();
    const item = await svc.create('Partner token', 'Bearer s3cr3t', 'staff@x');
    expect(JSON.stringify(item)).not.toContain('s3cr3t');
    expect(JSON.stringify(rows)).not.toContain('s3cr3t');
    expect(JSON.stringify(await svc.list())).not.toContain('s3cr3t');
    expect((await svc.resolve(['id1'])).get('id1')).toBe('Bearer s3cr3t');
  });
  it('refuses to store without the key', async () => {
    delete process.env.MARKETING_WEBHOOK_SECRETS_KEY;
    await expect(setup().svc.create('x', 'y', 'a')).rejects.toThrow('MARKETING_WEBHOOK_SECRETS_KEY');
  });
});
```

```ts
// application/marketing-webhook.worker.spec.ts
import { UnrecoverableError } from 'bullmq';
import { MARKETING_WEBHOOK_MAX_ATTEMPTS, MarketingWebhookWorker } from './marketing-webhook.worker';

const SID = '11111111-1111-4111-8111-111111111111';
function setup(row: Record<string, unknown> | null) {
  const saved: Record<string, unknown>[] = [];
  const deliveries = { findOne: jest.fn(async () => row), save: jest.fn(async (d: Record<string, unknown>) => { saved.push({ ...d }); return d; }) };
  const secrets = { configured: () => true, resolve: jest.fn(async () => new Map([[SID, 'Bearer s3cr3t']])) };
  return { worker: new MarketingWebhookWorker(deliveries as never, secrets as never), saved };
}
const row = (over: object = {}) => ({ id: 'd1', kind: 'marketing', status: 'pending', attempts: 0, method: 'POST', targetUrl: 'https://93.184.216.34/h',
  headers: [{ key: 'Authorization', value: `{{secret:${SID}}}` }], payload: '{"a":1}', statusCode: null, error: null, ...over });
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('MarketingWebhookWorker', () => {
  it('marks success', async () => {
    global.fetch = jest.fn(async () => ({ status: 200, ok: true, text: async () => '' })) as never;
    const { worker, saved } = setup(row());
    await worker.handle('d1');
    expect(saved.at(-1)).toMatchObject({ status: 'success', statusCode: 200, attempts: 1 });
  });
  it('keeps a 5xx pending for retry, then fails at the last attempt', async () => {
    global.fetch = jest.fn(async () => ({ status: 503, ok: false, text: async () => '' })) as never;
    const a = setup(row());
    await expect(a.worker.handle('d1')).rejects.toThrow('http_503');
    expect(a.saved.at(-1)).toMatchObject({ status: 'pending', error: 'http_503' });
    const b = setup(row({ attempts: MARKETING_WEBHOOK_MAX_ATTEMPTS - 1 }));
    await expect(b.worker.handle('d1')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(b.saved.at(-1)).toMatchObject({ status: 'failed' });
  });
  it('fails a blocked URL at once and never stores the secret', async () => {
    global.fetch = jest.fn() as never;
    const { worker, saved } = setup(row({ targetUrl: 'http://169.254.169.254/latest' }));
    await expect(worker.handle('d1')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(saved.at(-1)).toMatchObject({ status: 'failed', error: 'blocked_url' });
    expect(JSON.stringify(saved)).not.toContain('s3cr3t');
  });
  it('ignores rows that are not pending marketing deliveries', async () => {
    global.fetch = jest.fn() as never;
    await setup(null).worker.handle('d1');
    await setup(row({ status: 'success' })).worker.handle('d1');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow/application`

- [ ] **Step 4: Implement**

```ts
// application/webhook-send.ts
import { assertPublicHttpUrl, BlockedUrlError, Resolver } from '../../../../shared-kernel/infrastructure/public-url';
import { SECRET_REF } from '../domain/template';
import type { WebhookHeader, WebhookMethod } from '../domain/workflow.types';

/** `code` is safe to store and show: it never carries header values or the target's body. */
export class WebhookSendError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly status: number | null = null) { super(code); }
}
export interface WebhookRequest { method: WebhookMethod; url: string; headers: WebhookHeader[]; body: string | null; deliveryId?: string }

/** One HTTP attempt of a marketing webhook (worker and the editor's test send). Throws WebhookSendError. */
export async function sendWebhook(
  req: WebhookRequest, secrets: Map<string, string>,
  opts: { fetchImpl?: typeof fetch; resolve?: Resolver; timeoutMs?: number } = {},
): Promise<{ status: number; body: string }> {
  try { await assertPublicHttpUrl(req.url, opts.resolve); } catch (e) {
    throw new WebhookSendError(e instanceof BlockedUrlError ? e.message : 'blocked_url', false);
  }
  const headers: Record<string, string> = {};
  for (const h of req.headers) {
    const ref = SECRET_REF.exec(h.value);
    if (!ref) { headers[h.key] = h.value; continue; }
    const value = secrets.get(ref[1].toLowerCase()) ?? secrets.get(ref[1]);
    if (value === undefined) throw new WebhookSendError('secret_missing', false);
    headers[h.key] = value;
  }
  if (req.body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  if (req.deliveryId) headers['x-delivery-id'] = req.deliveryId;
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(req.url, {
      method: req.method, headers, body: req.method === 'GET' ? undefined : req.body ?? undefined,
      redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (e) {
    throw new WebhookSendError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
  }
  const body = (await res.text().catch(() => '')).slice(0, 2048);
  if (res.status >= 300 && res.status < 400) throw new WebhookSendError('redirect_not_followed', false, res.status);
  if (res.ok) return { status: res.status, body };
  throw new WebhookSendError(`http_${res.status}`, res.status >= 500 || res.status === 408 || res.status === 429, res.status);
}
```

```ts
// application/webhook-secrets.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { secretCipher } from '../../../../shared-kernel/infrastructure/secret-cipher';
import { MarketingWebhookSecret } from '../infrastructure/marketing-webhook-secret.entity';
import type { WebhookSecretItem } from '@cp/marketing-workflow';

const cipher = secretCipher('MARKETING_WEBHOOK_SECRETS_KEY', {
  missingKey: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า MARKETING_WEBHOOK_SECRETS_KEY จึงยังเก็บค่าลับของ webhook ไม่ได้ — แจ้งทีมระบบ',
  malformed: 'ค่าลับที่เก็บไว้อ่านไม่ได้ กรุณาบันทึกใหม่',
  wrongKey: 'ค่าลับที่เก็บไว้อ่านไม่ได้ (คีย์เปลี่ยน?) กรุณาบันทึกใหม่',
});
const item = (r: MarketingWebhookSecret): WebhookSecretItem =>
  ({ id: r.id, name: r.name, createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString() });

/** Webhook header secrets (spec §4.6): write-only through the API; only the sender reads the plain value. */
@Injectable()
export class WebhookSecretsService {
  constructor(@InjectRepository(MarketingWebhookSecret) private readonly repo: Repository<MarketingWebhookSecret>) {}

  configured() { return cipher.configured(); }
  async list(): Promise<WebhookSecretItem[]> { return (await this.repo.find({ order: { name: 'ASC' } })).map(item); }
  async create(name: string, value: string, actor: string): Promise<WebhookSecretItem> {
    return item(await this.repo.save({ name, valueEncrypted: cipher.encrypt(value), createdBy: actor }));
  }
  async replace(id: string, value: string): Promise<WebhookSecretItem> {
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException('ไม่พบค่าลับนี้');
    return item(await this.repo.save({ ...row, valueEncrypted: cipher.encrypt(value) }));
  }
  async remove(id: string): Promise<void> { await this.repo.delete({ id }); }

  /** Sender only. Ids that are gone or can't be decrypted are left out (→ secret_missing). */
  async resolve(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    for (const r of await this.repo.findBy({ id: In(ids) })) {
      try { out.set(r.id, cipher.decrypt(r.valueEncrypted)); } catch { /* left out */ }
    }
    return out;
  }
}
```

```ts
// application/marketing-webhook.worker.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { deliveryBackoff, QUEUES } from '../../../../config/redis.config';
import { WebhookDelivery } from '../../webhook-subscription/infrastructure/webhook-delivery.entity';
import { secretIdsOf } from '../domain/template';
import type { WebhookMethod } from '../domain/workflow.types';
import { sendWebhook, WebhookSendError } from './webhook-send';
import { WebhookSecretsService } from './webhook-secrets.service';

/** ~15 minutes with deliveryBackoff (1s doubling, capped 60s) — external endpoints, not a platform catching up. */
export const MARKETING_WEBHOOK_MAX_ATTEMPTS = 20;

@Processor(QUEUES.MARKETING_WEBHOOK, { settings: { backoffStrategy: deliveryBackoff } })
export class MarketingWebhookWorker extends WorkerHost {
  constructor(
    @InjectRepository(WebhookDelivery) private readonly deliveries: Repository<WebhookDelivery>,
    private readonly secrets: WebhookSecretsService,
  ) { super(); }

  async process(job: Job<{ deliveryId: string }>): Promise<void> { await this.handle(job.data.deliveryId); }

  async handle(deliveryId: string): Promise<void> {
    const d = await this.deliveries.findOne({ where: { id: deliveryId, kind: 'marketing' } });
    if (!d || d.status !== 'pending') return;
    d.attempts += 1;
    try {
      const headers = d.headers ?? [];
      const ids = secretIdsOf(headers);
      if (ids.length && !this.secrets.configured()) throw new WebhookSendError('secret_key_missing', false);
      const res = await sendWebhook({ method: (d.method ?? 'POST') as WebhookMethod, url: d.targetUrl, headers,
        body: typeof d.payload === 'string' ? d.payload : null, deliveryId: d.id }, await this.secrets.resolve(ids));
      d.status = 'success'; d.statusCode = res.status; d.error = null;
      await this.deliveries.save(d);
    } catch (e) {
      const err = e instanceof WebhookSendError ? e : new WebhookSendError('send_failed', true);
      d.statusCode = err.status; d.error = err.code;
      if (!err.retryable || d.attempts >= MARKETING_WEBHOOK_MAX_ATTEMPTS) {
        d.status = 'failed';
        await this.deliveries.save(d);
        throw new UnrecoverableError(err.code);
      }
      await this.deliveries.save(d);
      throw err;
    }
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow/application`

- [ ] **Step 6: Commit**

```bash
git add apps/commerce-platform/src/config/redis.config.ts apps/commerce-platform/src/modules/integration/marketing-workflow/application
git commit -m "feat(marketing-workflow): webhook sender (SSRF guard, secrets at send time), worker, secret store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: commerce — engine (enroll, walk steps, wait/resume, actions)

**Files:**
- Create: `.../marketing-workflow/infrastructure/workflow.store.ts`
- Create: `.../application/marketing-events.ts`, `workflow-queue.ts`, `workflow-engine.service.ts`
- Test: `.../application/workflow-engine.spec.ts`, `.../infrastructure/workflow.store.db.spec.ts` (opt-in)

**Interfaces:**
- Consumes: `SegmentsService.userMatchesSegment` (Task 4), `SettingsService.get<T>(scope, key)` (`modules/core/settings/application/settings.service.ts`), `EVENT_BUS` / `IEventBus.publish(event, manager?)`, `DomainEvent(aggregateId, payload)`, domain helpers (Task 3), `MARKETING_WEBHOOK_MAX_ATTEMPTS` (Task 5).
- Produces:
  - `EnrollmentRecord { id; workflowId; userId; occurrenceKey; status; currentStepId: string | null; resumeAt: Date | null; isHoldout; isTest; skipWaits; splitAssignments: Record<string, string>; startedAt: Date }`
  - `WorkflowStore` methods: `insertEnrollment({ workflowId, userId, occurrenceKey, entryStepId, holdout, test, skipWaits }): Promise<string | null>`, `lockDue(m, id)`, `workflow(m, id)`, `park(m, id, stepId, resumeAt)`, `finish(m, id, status, reason)`, `saveSplit(m, id, assignments)`, `log(m, enrollmentId, stepId, kind, status, meta)`, `hasCountedOrderSince(m, userId, since)`, `countedOrderCount(m, userId)`, `notifiesQueuedToday(m, userId)`, `insertWebhookDelivery(m, { idempotencyKey, url, method, headers, body })`, `customerData(m, userId)`, `inCooldown(workflowId, userId, days)`, `dueEnrollmentIds(limit)`, `stalePendingWebhookIds(limit)` (+ Task 7 adds trigger queries)
  - `WorkflowQueue { step(enrollmentId, delayMs?): void; trigger(kind, userId): void; webhook(deliveryId): void }`
  - `WorkflowEngine { enroll(wf, userId, occurrenceKey, opts?: { test?: boolean; skipWaits?: boolean }): Promise<string | null>; process(enrollmentId): Promise<void>; passesAudience(wf, userId, m): Promise<boolean> }`
  - Events `MarketingNotifyRequested` (`type 'marketing.notify'`), `MarketingGrantCouponRequested` (`type 'marketing.grant_coupon'`).

- [ ] **Step 1: Events + queue**

```ts
// application/marketing-events.ts
import { DomainEvent } from '../../../../shared-kernel/domain/domain-event';
import type { NotifyChannel } from '../domain/workflow.types';

/** To josh (`internal/erp-events`): deliver a notify template; josh dedupes on dedupeKey. Aggregate = the josh user. */
export interface MarketingNotifyPayload { userId: string; templateKey: string; channels: NotifyChannel[]; data: Record<string, unknown>; dedupeKey: string }
export class MarketingNotifyRequested extends DomainEvent<MarketingNotifyPayload> { readonly type = 'marketing.notify'; }

/** To josh: grant a coupon (idempotent per coupon + user in josh). */
export interface MarketingGrantCouponPayload { userId: string; couponId: string }
export class MarketingGrantCouponRequested extends DomainEvent<MarketingGrantCouponPayload> { readonly type = 'marketing.grant_coupon'; }
```

```ts
// application/workflow-queue.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUES } from '../../../../config/redis.config';
import { MARKETING_WEBHOOK_MAX_ATTEMPTS } from './marketing-webhook.worker';

const KEEP = { removeOnComplete: 1000, removeOnFail: 5000 } as const;

/**
 * Fire-and-forget producers. Never awaited inside a transaction: BullMQ hangs while Redis is down, and the minute
 * sweep (WorkflowSweep) picks up anything a lost job would have done.
 */
@Injectable()
export class WorkflowQueue {
  private readonly logger = new Logger(WorkflowQueue.name);
  constructor(
    @InjectQueue(QUEUES.MARKETING) private readonly jobs: Queue,
    @InjectQueue(QUEUES.MARKETING_WEBHOOK) private readonly webhooks: Queue,
  ) {}

  step(enrollmentId: string, delayMs = 0): void {
    this.jobs.add('step', { enrollmentId }, { ...KEEP, delay: delayMs, jobId: `step_${enrollmentId}_${Date.now() + delayMs}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
      .catch((e) => this.logger.warn(`enqueue step ${enrollmentId}: ${e}`));
  }
  trigger(kind: 'customer' | 'order', userId: string): void {
    this.jobs.add('trigger', { kind, userId }, { ...KEEP, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
      .catch((e) => this.logger.warn(`enqueue trigger ${kind} ${userId}: ${e}`));
  }
  webhook(deliveryId: string): void {
    this.webhooks.add('deliver', { deliveryId }, { ...KEEP, jobId: `wh_${deliveryId}`, attempts: MARKETING_WEBHOOK_MAX_ATTEMPTS, backoff: { type: 'custom' } })
      .catch((e) => this.logger.warn(`enqueue webhook ${deliveryId}: ${e}`));
  }
}
```

- [ ] **Step 2: Store**

```ts
// infrastructure/workflow.store.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { JOSH_ACTIVE_ORDER_STATUSES } from '../../customers/customer-metrics.service';
import type { WebhookHeader } from '../domain/workflow.types';
import { MarketingWorkflowRow } from './marketing-workflow.entity';

export interface EnrollmentRecord {
  id: string; workflowId: string; userId: string; occurrenceKey: string; status: string; currentStepId: string | null;
  resumeAt: Date | null; isHoldout: boolean; isTest: boolean; skipWaits: boolean; splitAssignments: Record<string, string>; startedAt: Date;
}
type Row = Record<string, unknown>;
const toEnrollment = (r: Row): EnrollmentRecord => ({
  id: r.id as string, workflowId: r.workflow_id as string, userId: r.user_id as string, occurrenceKey: r.occurrence_key as string,
  status: r.status as string, currentStepId: (r.current_step_id as string | null) ?? null, resumeAt: (r.resume_at as Date | null) ?? null,
  isHoldout: !!r.is_holdout, isTest: !!r.is_test, skipWaits: !!r.skip_waits,
  splitAssignments: (r.split_assignments as Record<string, string>) ?? {}, startedAt: new Date(r.started_at as string),
});
const COUNTED = [...JOSH_ACTIVE_ORDER_STATUSES];

/** Every SQL the marketing workflow engine and triggers run (so the logic above it is unit-tested with a fake). */
@Injectable()
export class WorkflowStore {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async insertEnrollment(i: { workflowId: string; userId: string; occurrenceKey: string; entryStepId: string | null; holdout: boolean; test: boolean; skipWaits: boolean }): Promise<string | null> {
    const rows = await this.db.query(
      `INSERT INTO marketing_workflow_enrollments (workflow_id, user_id, occurrence_key, status, current_step_id, is_holdout, is_test, skip_waits, completed_at, end_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN 'holdout' END)
       ON CONFLICT (workflow_id, user_id, occurrence_key) DO NOTHING RETURNING id`,
      [i.workflowId, i.userId, i.occurrenceKey, i.holdout ? 'completed' : 'pending', i.holdout ? null : i.entryStepId, i.holdout, i.test, i.skipWaits]);
    return rows[0]?.id ?? null;
  }

  async lockDue(m: EntityManager, id: string): Promise<EnrollmentRecord | null> {
    const [r] = await m.query(`SELECT * FROM marketing_workflow_enrollments WHERE id = $1 AND status IN ('pending', 'running')
      AND (resume_at IS NULL OR resume_at <= now()) FOR UPDATE SKIP LOCKED`, [id]);
    return r ? toEnrollment(r) : null;
  }

  workflow(m: EntityManager, id: string): Promise<MarketingWorkflowRow | null> { return m.getRepository(MarketingWorkflowRow).findOneBy({ id }); }

  async park(m: EntityManager, id: string, stepId: string, resumeAt: Date) {
    await m.query(`UPDATE marketing_workflow_enrollments SET status = 'running', current_step_id = $2, resume_at = $3 WHERE id = $1`, [id, stepId, resumeAt]);
  }
  async finish(m: EntityManager, id: string, status: 'completed' | 'skipped' | 'failed', reason: string | null) {
    await m.query(`UPDATE marketing_workflow_enrollments SET status = $2, end_reason = $3, completed_at = now(), current_step_id = NULL, resume_at = NULL
      WHERE id = $1`, [id, status, reason]);
  }
  async saveSplit(m: EntityManager, id: string, assignments: Record<string, string>) {
    await m.query(`UPDATE marketing_workflow_enrollments SET split_assignments = $2::jsonb WHERE id = $1`, [id, JSON.stringify(assignments)]);
  }
  async log(m: EntityManager, enrollmentId: string, stepId: string, kind: string, status: 'sent' | 'queued' | 'skipped' | 'failed', meta: Record<string, unknown>) {
    await m.query(`INSERT INTO marketing_workflow_action_logs (enrollment_id, step_id, kind, status, meta) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [enrollmentId, stepId, kind, status, JSON.stringify(meta)]);
  }
  async hasCountedOrderSince(m: EntityManager, userId: string, since: Date): Promise<boolean> {
    const [r] = await m.query(`SELECT EXISTS (SELECT 1 FROM josh_orders WHERE user_id = $1 AND status = ANY($2::text[]) AND create_date >= $3) AS hit`,
      [userId, COUNTED, since]);
    return !!r?.hit;
  }
  async countedOrderCount(m: EntityManager, userId: string): Promise<number> {
    const [r] = await m.query(`SELECT count(*)::int AS n FROM josh_orders WHERE user_id = $1 AND status = ANY($2::text[])`, [userId, COUNTED]);
    return r?.n ?? 0;
  }
  /** Commerce-queued notifies for this customer today (Bangkok day), test runs excluded. */
  async notifiesQueuedToday(m: EntityManager, userId: string): Promise<number> {
    const [r] = await m.query(`SELECT count(*)::int AS n FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
      WHERE e.user_id = $1 AND NOT e.is_test AND l.kind = 'notify' AND l.status = 'queued'
        AND l.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')`, [userId]);
    return r?.n ?? 0;
  }
  /** One delivery per enrollment + step (idempotency_key); a re-run returns the existing row's id. */
  async insertWebhookDelivery(m: EntityManager, d: { idempotencyKey: string; url: string; method: string; headers: WebhookHeader[]; body: string | null }): Promise<string> {
    const [r] = await m.query(`INSERT INTO webhook_deliveries (id, subscription_id, event_type, event_id, target_url, payload, status, attempts, kind, method, headers, idempotency_key, created_at, updated_at)
      VALUES ($1, NULL, 'marketing.webhook', NULL, $2, $3::jsonb, 'pending', 0, 'marketing', $4, $5::jsonb, $6, now(), now())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING id`,
      [randomUUID(), d.url, JSON.stringify(d.body), d.method, JSON.stringify(d.headers), d.idempotencyKey]);
    return r.id;
  }
  async customerData(m: EntityManager, userId: string): Promise<Record<string, unknown> | null> {
    const [r] = await m.query(`SELECT data FROM josh_customers WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    return (r?.data as Record<string, unknown>) ?? null;
  }
  async inCooldown(workflowId: string, userId: string, days: number): Promise<boolean> {
    const [r] = await this.db.query(`SELECT EXISTS (SELECT 1 FROM marketing_workflow_enrollments WHERE workflow_id = $1 AND user_id = $2 AND NOT is_test
      AND started_at > now() - make_interval(days => $3)) AS hit`, [workflowId, userId, days]);
    return !!r?.hit;
  }
  /** Waits that are due, plus pending enrollments whose first job was lost (> 2 min old). */
  async dueEnrollmentIds(limit: number): Promise<string[]> {
    const rows = await this.db.query(`(SELECT id FROM marketing_workflow_enrollments WHERE status = 'running' AND resume_at <= now() ORDER BY resume_at LIMIT $1)
      UNION ALL (SELECT id FROM marketing_workflow_enrollments WHERE status = 'pending' AND started_at < now() - interval '2 minutes' ORDER BY started_at LIMIT $1)`, [limit]);
    return rows.map((r: { id: string }) => r.id);
  }
  async stalePendingWebhookIds(limit: number): Promise<string[]> {
    const rows = await this.db.query(`SELECT id FROM webhook_deliveries WHERE kind = 'marketing' AND status = 'pending' AND updated_at < now() - interval '10 minutes'
      ORDER BY updated_at LIMIT $1`, [limit]);
    return rows.map((r: { id: string }) => r.id);
  }
}
```

- [ ] **Step 3: Failing engine spec (fake store)**

```ts
// application/workflow-engine.spec.ts
import { WorkflowEngine } from './workflow-engine.service';
import type { EnrollmentRecord } from '../infrastructure/workflow.store';
import type { WorkflowStep } from '../domain/workflow.types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = '11111111-1111-4111-8111-111111111111';
const notify = (n: number, nextId: string | null): WorkflowStep => ({ id: id(n), type: 'action', action: { kind: 'notify', channels: ['push'], templateKey: 'custom_a' }, nextId });

function setup(steps: WorkflowStep[], over: { status?: string; exitOnGoal?: object | null; ordered?: boolean; cap?: object | null; members?: string[] } = {}) {
  const wf = { id: 'wf1', name: 'W', status: over.status ?? 'active', entryStepId: steps[0]?.id ?? null, steps, schedule: null, cooldownDays: 0,
    holdoutPercent: 0, exitOnGoal: over.exitOnGoal ?? null, triggerType: 'first_login', triggerConfig: {} };
  const enrollments = new Map<string, EnrollmentRecord>();
  const logs: { stepId: string; kind: string; status: string; meta: Record<string, unknown> }[] = [];
  const now = () => new Date();
  const store = {
    insertEnrollment: jest.fn(async (i: { userId: string; occurrenceKey: string; entryStepId: string | null; holdout: boolean; test: boolean; skipWaits: boolean }) => {
      const key = `${i.userId}:${i.occurrenceKey}`;
      if ([...enrollments.values()].some((e) => `${e.userId}:${e.occurrenceKey}` === key)) return null;
      const e: EnrollmentRecord = { id: `e${enrollments.size + 1}`, workflowId: 'wf1', userId: i.userId, occurrenceKey: i.occurrenceKey,
        status: i.holdout ? 'completed' : 'pending', currentStepId: i.holdout ? null : i.entryStepId, resumeAt: null, isHoldout: i.holdout,
        isTest: i.test, skipWaits: i.skipWaits, splitAssignments: {}, startedAt: now() };
      enrollments.set(e.id, e); return e.id;
    }),
    lockDue: jest.fn(async (_m: unknown, eid: string) => {
      const e = enrollments.get(eid);
      return e && ['pending', 'running'].includes(e.status) && (!e.resumeAt || e.resumeAt <= now()) ? { ...e } : null;
    }),
    workflow: jest.fn(async () => wf),
    park: jest.fn(async (_m: unknown, eid: string, stepId: string, resumeAt: Date) => Object.assign(enrollments.get(eid)!, { status: 'running', currentStepId: stepId, resumeAt })),
    finish: jest.fn(async (_m: unknown, eid: string, status: string, reason: string | null) => Object.assign(enrollments.get(eid)!, { status, endReason: reason, currentStepId: null })),
    saveSplit: jest.fn(async (_m: unknown, eid: string, a: Record<string, string>) => Object.assign(enrollments.get(eid)!, { splitAssignments: a })),
    log: jest.fn(async (_m: unknown, _e: string, stepId: string, kind: string, status: string, meta: Record<string, unknown>) => { logs.push({ stepId, kind, status, meta }); }),
    hasCountedOrderSince: jest.fn(async () => !!over.ordered),
    countedOrderCount: jest.fn(async () => 2),
    notifiesQueuedToday: jest.fn(async () => 5),
    insertWebhookDelivery: jest.fn(async () => 'd1'),
    customerData: jest.fn(async () => ({ first_name: 'Nok' })),
    inCooldown: jest.fn(async () => false),
  };
  const events = { publish: jest.fn(async () => undefined) };
  const segments = { userMatchesSegment: jest.fn(async (sid: string) => (over.members ?? []).includes(sid)) };
  const queue = { step: jest.fn(), webhook: jest.fn(), trigger: jest.fn() };
  const settings = { get: jest.fn(async () => over.cap ?? null) };
  const db = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn({})), manager: {} };
  const engine = new WorkflowEngine(db as never, store as never, events as never, segments as never, queue as never, settings as never);
  const run = async (occurrence = 'once', opts = {}) => { const eid = await engine.enroll(wf as never, U, occurrence, opts); if (eid) await engine.process(eid); return eid!; };
  return { engine, wf, store, events, queue, logs, enrollments, run };
}

describe('WorkflowEngine', () => {
  it('walks steps, publishes notify in the transaction, queues the webhook after commit', async () => {
    const steps: WorkflowStep[] = [notify(1, id(2)), { id: id(2), type: 'webhook', method: 'POST', url: 'https://h.co/{{user_first_name}}', headers: [], body: '{"n":"{{user_name}}"}', nextId: null }];
    const s = setup(steps);
    const eid = await s.run();
    expect(s.events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'marketing.notify', payload: expect.objectContaining({ dedupeKey: `cmw:wf1:${eid}:${id(1)}` }) }), {});
    expect(s.store.insertWebhookDelivery).toHaveBeenCalledWith({}, expect.objectContaining({ url: 'https://h.co/Nok', idempotencyKey: `cmw:${eid}:${id(2)}` }));
    expect(s.queue.webhook).toHaveBeenCalledWith('d1');
    expect(s.enrollments.get(eid)!.status).toBe('completed');
  });

  it('parks at a wait, then resumes from the next step', async () => {
    const s = setup([{ id: id(1), type: 'wait', hours: 1, nextId: id(2) }, notify(2, null)]);
    const eid = await s.run();
    expect(s.enrollments.get(eid)).toMatchObject({ status: 'running', currentStepId: id(2) });
    expect(s.queue.step).toHaveBeenLastCalledWith(eid, 3_600_000);
    expect(s.events.publish).not.toHaveBeenCalled();
    s.enrollments.get(eid)!.resumeAt = new Date(Date.now() - 1);
    await s.engine.process(eid);
    expect(s.events.publish).toHaveBeenCalledTimes(1);
    expect(s.enrollments.get(eid)!.status).toBe('completed');
  });

  it('skips waits on a test run that asks for it', async () => {
    const s = setup([{ id: id(1), type: 'wait', hours: 1, nextId: id(2) }, notify(2, null)]);
    await s.run('test:1', { test: true, skipWaits: true });
    expect(s.events.publish).toHaveBeenCalledTimes(1);
  });

  it('follows condition yes / no', async () => {
    const cond = (expr: string): WorkflowStep[] => [{ id: id(1), type: 'condition', expression: expr, yesNextId: id(2), noNextId: id(3) }, notify(2, null), notify(3, null)];
    const yes = setup(cond('user.order_count >= 2')); await yes.run();
    expect(yes.logs.find((l) => l.kind === 'notify')!.stepId).toBe(id(2));
    const no = setup(cond('user.order_count > 5')); await no.run();
    expect(no.logs.find((l) => l.kind === 'notify')!.stepId).toBe(id(3));
  });

  it('keeps the A/B branch it picked', async () => {
    const steps: WorkflowStep[] = [{ id: id(1), type: 'split', branches: [{ id: 'a', label: 'A', percent: 50, nextId: id(2) }, { id: 'b', label: 'B', percent: 50, nextId: id(3) }] }, notify(2, null), notify(3, null)];
    const s = setup(steps);
    const eid = await s.run();
    const picked = s.enrollments.get(eid)!.splitAssignments[id(1)];
    expect(['a', 'b']).toContain(picked);
    expect(s.logs.find((l) => l.kind === 'split')!.meta).toMatchObject({ branchId: picked });
  });

  it('ends safely: cycle, removed step, paused workflow, goal reached, audience changed', async () => {
    const cyc = setup([notify(1, id(2)), notify(2, id(1))]); const c = await cyc.run();
    expect(cyc.enrollments.get(c)).toMatchObject({ status: 'failed', endReason: 'cycle_detected' });

    const gone = setup([{ id: id(1), type: 'wait', hours: 1, nextId: id(2) }, notify(2, null)]); const g = await gone.run();
    gone.wf.steps = gone.wf.steps.slice(0, 1); gone.enrollments.get(g)!.resumeAt = new Date(0);
    await gone.engine.process(g);
    expect(gone.enrollments.get(g)).toMatchObject({ status: 'skipped', endReason: 'step_removed' });

    const paused = setup([{ id: id(1), type: 'wait', hours: 1, nextId: id(2) }, notify(2, null)]); const p = await paused.run();
    paused.wf.status = 'paused'; paused.enrollments.get(p)!.resumeAt = new Date(0);
    await paused.engine.process(p);
    expect(paused.enrollments.get(p)).toMatchObject({ status: 'skipped', endReason: 'workflow_paused' });

    const goal = setup([notify(1, null)], { exitOnGoal: { kind: 'order_placed' }, ordered: true }); const gl = await goal.run();
    expect(goal.enrollments.get(gl)).toMatchObject({ status: 'skipped', endReason: 'goal_reached' });

    const aud = setup([{ id: id(1), type: 'audience', segmentIds: [id(9)], nextId: id(2) }, notify(2, null)], { members: [id(9)] });
    const a = await aud.engine.enroll(aud.wf as never, U, 'once');
    (aud as unknown as { engine: { segments: { userMatchesSegment: jest.Mock } } }).engine.segments.userMatchesSegment.mockResolvedValue(false);
    await aud.engine.process(a!);
    expect(aud.enrollments.get(a!)).toMatchObject({ status: 'skipped', endReason: 'audience_changed' });
  });

  it('frequency cap skips the notify but the flow goes on', async () => {
    const s = setup([notify(1, id(2)), { id: id(2), type: 'action', action: { kind: 'grant_coupon', couponId: U }, nextId: null }], { cap: { enabled: true, maxPerUserPerDay: 3 } });
    await s.run();
    expect(s.logs.map((l) => `${l.kind}:${l.status}`)).toEqual(['notify:skipped', 'grant_coupon:queued']);
  });

  it('enroll: inactive / outside audience / duplicate → nothing; holdout → completed without a job', async () => {
    expect(await setup([notify(1, null)], { status: 'paused' }).engine.enroll(setup([]).wf as never, U, 'x')).toBeNull();
    const aud = setup([{ id: id(1), type: 'audience', segmentIds: [id(9)], nextId: null }]);
    expect(await aud.engine.enroll(aud.wf as never, U, 'once')).toBeNull();
    const dup = setup([notify(1, null)]);
    expect(await dup.engine.enroll(dup.wf as never, U, 'once')).not.toBeNull();
    expect(await dup.engine.enroll(dup.wf as never, U, 'once')).toBeNull();
    const ho = setup([notify(1, null)]); ho.wf.holdoutPercent = 100 as never;
    const h = await ho.engine.enroll(ho.wf as never, U, 'once');
    expect(ho.enrollments.get(h!)).toMatchObject({ status: 'completed', isHoldout: true });
    expect(ho.queue.step).not.toHaveBeenCalled();
  });
});
```
Note: `holdoutPercent = 100` is above the validator's 50 cap on purpose — the engine must not depend on validation for correctness. The `paused` enroll line constructs a second setup only to get a paused `wf`; simplify to `const p = setup([notify(1, null)], { status: 'paused' }); expect(await p.engine.enroll(p.wf as never, U, 'x')).toBeNull();` when writing it.

- [ ] **Step 4: Run — expect FAIL** (`Cannot find module './workflow-engine.service'`)

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow-engine`

- [ ] **Step 5: Implement the engine**

```ts
// application/workflow-engine.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { SettingsService } from '../../../core/settings/application/settings.service';
import { SegmentsService } from '../../segments/segments.service';
import { bucket, pickBranch } from '../domain/bucket';
import { evaluateMarketingExpression } from '../domain/expression.evaluator';
import { checkExpression } from '../domain/expression.fields';
import { DEFAULT_MARKETING_TIMEZONE, isWithinMarketingSchedule, localDow, localHour } from '../domain/schedule';
import { renderWebhook, webhookVars } from '../domain/template';
import type { WorkflowAction, WorkflowStep } from '../domain/workflow.types';
import { MarketingWorkflowRow } from '../infrastructure/marketing-workflow.entity';
import { EnrollmentRecord, WorkflowStore } from '../infrastructure/workflow.store';
import { MarketingGrantCouponRequested, MarketingNotifyRequested } from './marketing-events';
import { WorkflowQueue } from './workflow-queue';

interface Run { m: EntityManager; wf: MarketingWorkflowRow; e: EnrollmentRecord; deliveries: string[] }
type Audience = Extract<WorkflowStep, { type: 'audience' }>;

/**
 * Commerce's marketing workflow runner (spec 2026-10-10 §4). One enrollment at a time, under a row lock: walks the
 * steps from the enrollment's pointer until a wait parks it or the flow ends. Notify / coupon leave through the outbox
 * in the same transaction; webhook rows are inserted in it and queued after commit.
 */
@Injectable()
export class WorkflowEngine {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly store: WorkflowStore,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
    private readonly segments: SegmentsService,
    private readonly queue: WorkflowQueue,
    private readonly settings: SettingsService,
  ) {}

  /** Inserts the enrollment (once per workflow + user + occurrence) and queues its first run. Test runs skip the gates. */
  async enroll(wf: MarketingWorkflowRow, userId: string, occurrenceKey: string, opts: { test?: boolean; skipWaits?: boolean } = {}): Promise<string | null> {
    if (!opts.test) {
      if (wf.status !== 'active') return null;
      if (!isWithinMarketingSchedule(wf.schedule, new Date())) return null;
      if (wf.cooldownDays > 0 && (await this.store.inCooldown(wf.id, userId, wf.cooldownDays))) return null;
      if (!(await this.passesAudience(wf, userId, this.db.manager))) return null;
    }
    const holdout = !opts.test && wf.holdoutPercent > 0 && bucket(`holdout:${wf.id}:${userId}:${occurrenceKey}`) < wf.holdoutPercent;
    const id = await this.store.insertEnrollment({ workflowId: wf.id, userId, occurrenceKey, entryStepId: wf.entryStepId, holdout, test: !!opts.test, skipWaits: !!opts.skipWaits });
    if (id && !holdout) this.queue.step(id);
    return id;
  }

  async process(enrollmentId: string): Promise<void> {
    const deliveries: string[] = [];
    let delayMs: number | null = null;
    await this.db.transaction(async (m) => {
      const e = await this.store.lockDue(m, enrollmentId);
      if (!e) return;
      const wf = await this.store.workflow(m, e.workflowId);
      if (!wf) { await this.store.finish(m, e.id, 'skipped', 'workflow_deleted'); return; }
      delayMs = await this.walk({ m, wf, e, deliveries });
    });
    for (const id of deliveries) this.queue.webhook(id);
    if (delayMs !== null) this.queue.step(enrollmentId, delayMs);
  }

  async passesAudience(wf: MarketingWorkflowRow, userId: string, m: EntityManager): Promise<boolean> {
    const a = wf.steps.find((s): s is Audience => s.type === 'audience');
    if (!a) return true;
    for (const sid of a.excludeSegmentIds ?? []) if (await this.segments.userMatchesSegment(sid, userId, m)) return false;
    const include = a.segmentIds ?? [];
    if (!include.length) return true;
    for (const sid of include) if (await this.segments.userMatchesSegment(sid, userId, m)) return true;
    return false;
  }

  /** Returns the wait in ms when the enrollment parks, else null (it finished). */
  private async walk(r: Run): Promise<number | null> {
    const { m, wf, e } = r;
    const end = async (status: 'completed' | 'skipped' | 'failed', reason: string | null) => { await this.store.finish(m, e.id, status, reason); return null; };
    if (wf.status !== 'active' && !e.isTest) return end('skipped', 'workflow_paused');
    if (await this.goalReached(r)) return end('skipped', 'goal_reached');
    const steps = new Map(wf.steps.map((s) => [s.id, s]));
    let id = e.currentStepId;
    let visits = 0;
    while (id) {
      if (++visits > wf.steps.length + 1) return end('failed', 'cycle_detected');
      const step = steps.get(id);
      if (!step) return end('skipped', 'step_removed');
      switch (step.type) {
        case 'audience':
          id = step.nextId; break;
        case 'wait': {
          const minutes = step.hours * 60 + (step.minutes ?? 0);
          if (minutes > 0 && step.nextId && !e.skipWaits) {
            const ms = minutes * 60_000;
            await this.store.park(m, e.id, step.nextId, new Date(Date.now() + ms));
            return ms;
          }
          id = step.nextId; break;
        }
        case 'condition': {
          const yes = await this.condition(r, step.expression);
          await this.store.log(m, e.id, step.id, 'condition', 'sent', { result: yes });
          id = yes ? step.yesNextId : step.noNextId; break;
        }
        case 'split': {
          const branch = await this.branch(r, step);
          await this.store.log(m, e.id, step.id, 'split', 'sent', { branchId: branch?.id ?? null, label: branch?.label ?? null });
          id = branch?.nextId ?? null; break;
        }
        case 'action':
        case 'webhook': {
          const kind = step.type === 'webhook' ? 'webhook' : step.action.kind;
          if (await this.goalReached(r)) { await this.store.log(m, e.id, step.id, kind, 'skipped', { reason: 'goal_reached' }); return end('skipped', 'goal_reached'); }
          if (!e.isTest && !(await this.passesAudience(wf, e.userId, m))) {
            await this.store.log(m, e.id, step.id, kind, 'skipped', { reason: 'audience_changed' });
            return end('skipped', 'audience_changed');
          }
          if (step.type === 'webhook') await this.webhook(r, step); else await this.action(r, step.id, step.action);
          id = step.nextId; break;
        }
      }
    }
    return end('completed', null);
  }

  private async goalReached({ m, wf, e }: Run): Promise<boolean> {
    return wf.exitOnGoal?.kind === 'order_placed' && (await this.store.hasCountedOrderSince(m, e.userId, e.startedAt));
  }

  private async condition({ m, wf, e }: Run, source: string): Promise<boolean> {
    const checked = checkExpression(source);
    if (!checked.ok) return false;
    const now = new Date();
    const tz = wf.schedule?.timezone || DEFAULT_MARKETING_TIMEZONE;
    return evaluateMarketingExpression(checked.node, {
      cartStillOpen: false, cartItemCount: 0, cartTotal: 0, pageViews: 0,
      stillNoOrder: !(await this.store.hasCountedOrderSince(m, e.userId, e.startedAt)),
      userOrderCount: await this.store.countedOrderCount(m, e.userId),
      timeInSchedule: isWithinMarketingSchedule(wf.schedule, now), timeHour: localHour(tz, now), timeDow: localDow(tz, now),
      segmentMatches: (sid) => this.segments.userMatchesSegment(sid, e.userId, m),
    });
  }

  private async branch({ m, e }: Run, step: Extract<WorkflowStep, { type: 'split' }>) {
    const saved = e.splitAssignments[step.id];
    const kept = saved ? step.branches.find((b) => b.id === saved) : undefined;
    if (kept) return kept;
    const picked = pickBranch(e.id, step.id, step.branches);
    if (picked) {
      e.splitAssignments = { ...e.splitAssignments, [step.id]: picked.id };
      await this.store.saveSplit(m, e.id, e.splitAssignments);
    }
    return picked;
  }

  private async action({ m, wf, e }: Run, stepId: string, a: WorkflowAction): Promise<void> {
    if (a.kind === 'notify') {
      if (!e.isTest && (await this.capReached(m, e.userId))) {
        await this.store.log(m, e.id, stepId, 'notify', 'skipped', { reason: 'frequency_cap', templateKey: a.templateKey });
        return;
      }
      await this.events.publish(new MarketingNotifyRequested(e.userId, { userId: e.userId, templateKey: a.templateKey, channels: a.channels,
        data: { ...(a.data ?? {}), workflow_id: wf.id }, dedupeKey: `cmw:${wf.id}:${e.id}:${stepId}` }), m);
      await this.store.log(m, e.id, stepId, 'notify', 'queued', { templateKey: a.templateKey, channels: a.channels });
      return;
    }
    await this.events.publish(new MarketingGrantCouponRequested(e.userId, { userId: e.userId, couponId: a.couponId }), m);
    await this.store.log(m, e.id, stepId, 'grant_coupon', 'queued', { couponId: a.couponId });
  }

  private async capReached(m: EntityManager, userId: string): Promise<boolean> {
    const cap = await this.settings.get<{ enabled?: boolean; maxPerUserPerDay?: number }>('marketing_workflow', 'frequency_cap');
    if (!cap?.enabled || !cap.maxPerUserPerDay) return false;
    return (await this.store.notifiesQueuedToday(m, userId)) >= cap.maxPerUserPerDay;
  }

  /** Renders now (values of this moment), sends later. Full SSRF / DNS check happens in the worker at send time. */
  private async webhook({ m, wf, e, deliveries }: Run, step: Extract<WorkflowStep, { type: 'webhook' }>): Promise<void> {
    const vars = webhookVars(await this.store.customerData(m, e.userId), { userId: e.userId, workflowId: wf.id, workflowName: wf.name, enrollmentId: e.id, stepId: step.id });
    const req = renderWebhook(step, vars);
    let host: string;
    try {
      const url = new URL(req.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
      host = url.host;
    } catch {
      await this.store.log(m, e.id, step.id, 'webhook', 'failed', { reason: 'invalid_url' });
      return;
    }
    const deliveryId = await this.store.insertWebhookDelivery(m, { idempotencyKey: `cmw:${e.id}:${step.id}`, url: req.url, method: req.method, headers: req.headers, body: req.body });
    deliveries.push(deliveryId);
    await this.store.log(m, e.id, step.id, 'webhook', 'queued', { method: req.method, host, deliveryId });
  }
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow-engine`

- [ ] **Step 7: Opt-in DB spec for the store SQL**

```ts
// infrastructure/workflow.store.db.spec.ts
import { DataSource } from 'typeorm';
import { WorkflowStore } from './workflow.store';

const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('WorkflowStore (real DB)', () => {
  let db: DataSource; let store: WorkflowStore; let wf: string;
  const U = '11111111-1111-4111-8111-111111111111';
  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url, entities: [__dirname + '/*.entity.ts'] }).initialize();
    store = new WorkflowStore(db);
    [{ id: wf }] = await db.query(`INSERT INTO marketing_workflows (name, trigger_type) VALUES ('db-spec', 'first_login') RETURNING id`);
  });
  afterAll(async () => { await db.query(`DELETE FROM marketing_workflows WHERE id = $1`, [wf]); await db.destroy(); });

  it('enrolls once per occurrence, locks, parks and finishes', async () => {
    const id = await store.insertEnrollment({ workflowId: wf, userId: U, occurrenceKey: 'once', entryStepId: 's1', holdout: false, test: false, skipWaits: false });
    expect(id).toBeTruthy();
    expect(await store.insertEnrollment({ workflowId: wf, userId: U, occurrenceKey: 'once', entryStepId: 's1', holdout: false, test: false, skipWaits: false })).toBeNull();
    await db.transaction(async (m) => {
      const e = await store.lockDue(m, id!);
      expect(e).toMatchObject({ currentStepId: 's1', status: 'pending' });
      await store.park(m, id!, 's2', new Date(Date.now() + 60_000));
    });
    await db.transaction(async (m) => expect(await store.lockDue(m, id!)).toBeNull());
    const d1 = await db.transaction((m) => store.insertWebhookDelivery(m, { idempotencyKey: `cmw:${id}:s3`, url: 'https://h.co', method: 'POST', headers: [], body: '{}' }));
    const d2 = await db.transaction((m) => store.insertWebhookDelivery(m, { idempotencyKey: `cmw:${id}:s3`, url: 'https://h.co', method: 'POST', headers: [], body: '{}' }));
    expect(d2).toBe(d1);
    await db.query(`DELETE FROM webhook_deliveries WHERE id = $1`, [d1]);
  });
});
```
Run (if a migrated local DB exists): `MARKETING_TEST_DATABASE_URL=postgres:///commerce_stage2_test npx jest -c apps/commerce-platform/jest.config.cts workflow.store.db` — expect PASS; otherwise it is skipped (report that).

- [ ] **Step 8: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-workflow
git commit -m "feat(marketing-workflow): engine — enroll, walk steps under a row lock, wait/resume, A/B, notify/coupon via outbox, webhook rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: commerce — triggers, conversion, PDPA, sweep, processor

**Files:**
- Modify: `.../marketing-workflow/infrastructure/workflow.store.ts` (trigger queries)
- Create: `.../application/workflow-triggers.service.ts`, `workflow-trigger.listener.ts`, `workflow.processor.ts`, `workflow-sweep.ts`
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.ts` (+ `josh-events.service.spec.ts`)
- Test: `.../application/workflow-triggers.spec.ts`

**Interfaces:**
- Consumes: `WorkflowEngine.enroll` (Task 6), `WorkflowQueue` (Task 6), `isScheduledFireDue`, `localDateKey` (Task 3).
- Produces:
  - `WorkflowStore` adds `activeWorkflows(types: TriggerType[]): Promise<MarketingWorkflowRow[]>`, `customerTime(userId, field: 'first_app_login_at' | 'last_app_login_at'): Promise<Date | null>`, `milestoneCrossed(userId, cfg, since: Date): Promise<boolean>`, `markConverted(userId): Promise<void>`, `customerDeleted(userId): Promise<void>`, `customerIdsAfter(afterId: string | null, limit): Promise<string[]>`, `setLastScheduledKey(workflowId, key)`.
  - `WorkflowTriggers { handle(kind: 'customer' | 'order', userId): Promise<void>; runScheduled(now?: Date): Promise<void> }`
  - EventEmitter signals from `JoshEventsService`: `'marketing-trigger.customer'`, `'marketing-trigger.order'`, `'marketing-trigger.customer-deleted'`, payload `{ userId: string }` (no `type` field, so `WebhookDispatcher`'s `**` listener ignores it).

- [ ] **Step 1: Failing trigger spec**

```ts
// application/workflow-triggers.spec.ts
import { WorkflowTriggers } from './workflow-triggers.service';

const U = '11111111-1111-4111-8111-111111111111';
const activated = new Date('2026-10-10T03:00:00Z');
const wf = (triggerType: string, triggerConfig: object = {}, over: object = {}) => ({ id: `wf-${triggerType}`, triggerType, triggerConfig, activatedAt: activated, lastScheduledKey: null, ...over });

function setup(workflows: ReturnType<typeof wf>[], times: { first?: Date | null; last?: Date | null } = {}, crossed = false) {
  const store = {
    activeWorkflows: jest.fn(async (types: string[]) => workflows.filter((w) => types.includes(w.triggerType))),
    customerTime: jest.fn(async (_u: string, f: string) => (f === 'first_app_login_at' ? times.first ?? null : times.last ?? null)),
    milestoneCrossed: jest.fn(async () => crossed),
    markConverted: jest.fn(async () => undefined),
    customerIdsAfter: jest.fn(async (after: string | null) => (after ? [] : [U, '22222222-2222-4222-8222-222222222222'])),
    setLastScheduledKey: jest.fn(async () => undefined),
  };
  const engine = { enroll: jest.fn(async () => 'e1') };
  return { t: new WorkflowTriggers(store as never, engine as never), store, engine };
}

describe('WorkflowTriggers', () => {
  it('first_login: only logins at/after activation, always the same occurrence', async () => {
    const before = setup([wf('first_login')], { first: new Date('2026-10-01T00:00:00Z') });
    await before.t.handle('customer', U);
    expect(before.engine.enroll).not.toHaveBeenCalled();
    const after = setup([wf('first_login')], { first: new Date('2026-10-10T05:00:00Z') });
    await after.t.handle('customer', U); await after.t.handle('customer', U);
    expect(after.engine.enroll.mock.calls.map((c) => c[2])).toEqual(['once', 'once']);
  });

  it('app_login: one occurrence per login timestamp', async () => {
    const s = setup([wf('app_login')], { last: new Date('2026-10-10T06:00:00Z') });
    await s.t.handle('customer', U);
    expect(s.engine.enroll).toHaveBeenCalledWith(expect.anything(), U, '2026-10-10T06:00:00.000Z');
    const old = setup([wf('app_login')], { last: new Date('2026-10-09T06:00:00Z') });
    await old.t.handle('customer', U);
    expect(old.engine.enroll).not.toHaveBeenCalled();
  });

  it('order: marks conversions, then enrolls milestone workflows that crossed after activation', async () => {
    const s = setup([wf('order_milestone', { metric: 'lifetime_spend', operator: '>=', value: 1000 })], {}, true);
    await s.t.handle('order', U);
    expect(s.store.markConverted).toHaveBeenCalledWith(U);
    expect(s.store.milestoneCrossed).toHaveBeenCalledWith(U, { metric: 'lifetime_spend', operator: '>=', value: 1000 }, activated);
    expect(s.engine.enroll).toHaveBeenCalledWith(expect.anything(), U, 'once');
    const no = setup([wf('order_milestone', { metric: 'lifetime_spend', operator: '>=', value: 1000 })], {}, false);
    await no.t.handle('order', U);
    expect(no.engine.enroll).not.toHaveBeenCalled();
  });

  it('scheduled: when due, enrolls every customer once for the local day and records it', async () => {
    const now = new Date('2026-10-10T11:05:00Z'); // 18:05 Bangkok
    const s = setup([wf('scheduled', { time: '18:00' })]);
    await s.t.runScheduled(now);
    expect(s.engine.enroll).toHaveBeenCalledTimes(2);
    expect(s.engine.enroll.mock.calls[0][2]).toBe('2026-10-10');
    expect(s.store.setLastScheduledKey).toHaveBeenCalledWith('wf-scheduled', '2026-10-10');
  });

  it('scheduled: not due, or already done today → nothing', async () => {
    const early = setup([wf('scheduled', { time: '20:00' })]);
    await early.t.runScheduled(new Date('2026-10-10T11:05:00Z'));
    const done = setup([wf('scheduled', { time: '18:00' }, { lastScheduledKey: '2026-10-10' })]);
    await done.t.runScheduled(new Date('2026-10-10T11:05:00Z'));
    expect(early.engine.enroll).not.toHaveBeenCalled();
    expect(done.engine.enroll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow-triggers`

- [ ] **Step 3: Store additions** (inside `WorkflowStore`; add imports `OrderMilestoneTriggerConfig, TriggerType` from `../domain/workflow.types`)

```ts
  activeWorkflows(types: TriggerType[]): Promise<MarketingWorkflowRow[]> {
    return this.db.getRepository(MarketingWorkflowRow).createQueryBuilder('w')
      .where(`w.status = 'active'`).andWhere('w.trigger_type IN (:...types)', { types }).getMany();
  }
  async customerTime(userId: string, field: 'first_app_login_at' | 'last_app_login_at'): Promise<Date | null> {
    const [r] = await this.db.query(`SELECT (data->>'${field}')::timestamptz AS at FROM josh_customers WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    return r?.at ? new Date(r.at) : null;
  }
  /** True when the metric meets the target now and (lifetime metrics) did not before activation; single order: one counted order since activation. */
  async milestoneCrossed(userId: string, cfg: OrderMilestoneTriggerConfig, since: Date): Promise<boolean> {
    const op = cfg.operator === '>' ? '>' : '>=';
    const base = `FROM josh_orders WHERE user_id = $1 AND status = ANY($2::text[])`;
    const sql = cfg.metric === 'single_order_total'
      ? `SELECT EXISTS (SELECT 1 ${base} AND create_date >= $3 AND total_price ${op} $4) AS hit`
      : (() => {
        const agg = cfg.metric === 'lifetime_spend' ? 'COALESCE(sum(total_price), 0)' : 'count(*)';
        return `SELECT ((SELECT ${agg} ${base}) ${op} $4) AND NOT ((SELECT ${agg} ${base} AND create_date < $3) ${op} $4) AS hit`;
      })();
    const [r] = await this.db.query(sql, [userId, COUNTED, since, cfg.value]);
    return !!r?.hit;
  }
  /** Converted = a counted order after the enrollment started, inside the workflow's window. */
  async markConverted(userId: string): Promise<void> {
    // Correlated subqueries, not a LATERAL join: UPDATE … FROM may not reference the target table laterally.
    await this.db.query(`UPDATE marketing_workflow_enrollments e SET converted_at = (SELECT min(o.create_date) FROM josh_orders o
        WHERE o.user_id = e.user_id AND o.status = ANY($2::text[]) AND o.create_date >= e.started_at)
      FROM marketing_workflows w
      WHERE e.workflow_id = w.id AND e.user_id = $1 AND e.converted_at IS NULL
        AND EXISTS (SELECT 1 FROM josh_orders o WHERE o.user_id = e.user_id AND o.status = ANY($2::text[]) AND o.create_date >= e.started_at
          AND o.create_date <= e.started_at + make_interval(days => w.conversion_window_days))`, [userId, COUNTED]);
  }
  /** PDPA delete: stop the customer's journeys and their unsent webhooks. */
  async customerDeleted(userId: string): Promise<void> {
    await this.db.query(`UPDATE webhook_deliveries SET status = 'failed', error = 'customer_deleted' WHERE kind = 'marketing' AND status = 'pending'
      AND id IN (SELECT (l.meta->>'deliveryId')::uuid FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
        WHERE e.user_id = $1 AND l.kind = 'webhook' AND l.meta ? 'deliveryId')`, [userId]);
    await this.db.query(`UPDATE marketing_workflow_enrollments SET status = 'skipped', end_reason = 'customer_deleted', completed_at = now(),
      current_step_id = NULL, resume_at = NULL WHERE user_id = $1 AND status IN ('pending', 'running')`, [userId]);
  }
  /** Keyset page over the customers commerce knows (PDPA-deleted excluded). */
  async customerIdsAfter(afterId: string | null, limit: number): Promise<string[]> {
    const rows = await this.db.query(`SELECT id FROM segment_customers WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`, [afterId, limit]);
    return rows.map((r: { id: string }) => r.id);
  }
  async setLastScheduledKey(workflowId: string, key: string): Promise<void> {
    await this.db.query(`UPDATE marketing_workflows SET last_scheduled_key = $2 WHERE id = $1`, [workflowId, key]);
  }
```
`field` and `op` are interpolated only from the two fixed unions above — never from input.

- [ ] **Step 4: Triggers service**

```ts
// application/workflow-triggers.service.ts
import { Injectable } from '@nestjs/common';
import { DEFAULT_MARKETING_TIMEZONE, isScheduledFireDue, localDateKey } from '../domain/schedule';
import type { OrderMilestoneTriggerConfig, ScheduledTriggerConfig } from '../domain/workflow.types';
import { MarketingWorkflowRow } from '../infrastructure/marketing-workflow.entity';
import { WorkflowStore } from '../infrastructure/workflow.store';
import { WorkflowEngine } from './workflow-engine.service';

/** Which commerce workflows a josh snapshot (or the clock) enrolls a customer into (spec §3.3). */
@Injectable()
export class WorkflowTriggers {
  constructor(private readonly store: WorkflowStore, private readonly engine: WorkflowEngine) {}

  async handle(kind: 'customer' | 'order', userId: string): Promise<void> {
    if (kind === 'order') await this.store.markConverted(userId);
    const workflows = await this.store.activeWorkflows(kind === 'customer' ? ['first_login', 'app_login'] : ['order_milestone']);
    for (const wf of workflows) {
      const key = await this.occurrence(wf, userId);
      if (key) await this.engine.enroll(wf, userId, key);
    }
  }

  private async occurrence(wf: MarketingWorkflowRow, userId: string): Promise<string | null> {
    const since = wf.activatedAt;
    if (!since) return null;
    if (wf.triggerType === 'first_login') {
      const at = await this.store.customerTime(userId, 'first_app_login_at');
      return at && at >= since ? 'once' : null;
    }
    if (wf.triggerType === 'app_login') {
      const at = await this.store.customerTime(userId, 'last_app_login_at');
      return at && at >= since ? at.toISOString() : null;
    }
    if (wf.triggerType === 'order_milestone') {
      return (await this.store.milestoneCrossed(userId, wf.triggerConfig as OrderMilestoneTriggerConfig, since)) ? 'once' : null;
    }
    return null;
  }

  /**
   * Every minute: a due scheduled workflow enrolls all customers (engine.enroll applies audience / cooldown) once per
   * local day; the day is recorded only after the whole scan, so a crash mid-scan resumes on the next tick.
   * ponytail: scans every customer per run; use frozen segment members as candidates if audiences get large.
   */
  async runScheduled(now = new Date()): Promise<void> {
    for (const wf of await this.store.activeWorkflows(['scheduled'])) {
      const cfg = wf.triggerConfig as ScheduledTriggerConfig;
      if (!isScheduledFireDue(cfg, now)) continue;
      const key = localDateKey(now, cfg.timezone || DEFAULT_MARKETING_TIMEZONE);
      if (wf.lastScheduledKey === key) continue;
      let after: string | null = null;
      for (;;) {
        const ids = await this.store.customerIdsAfter(after, 1000);
        if (!ids.length) break;
        for (const id of ids) await this.engine.enroll(wf, id, key);
        after = ids[ids.length - 1];
      }
      await this.store.setLastScheduledKey(wf.id, key);
    }
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow-triggers`

- [ ] **Step 6: Listener, processor, sweep**

```ts
// application/workflow-trigger.listener.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowStore } from '../infrastructure/workflow.store';
import { WorkflowQueue } from './workflow-queue';

/** josh-events applied a snapshot → a job checks triggers (never inside josh-events' own transaction). */
@Injectable()
export class WorkflowTriggerListener {
  private readonly logger = new Logger(WorkflowTriggerListener.name);
  constructor(private readonly queue: WorkflowQueue, private readonly store: WorkflowStore) {}

  @OnEvent('marketing-trigger.customer') customer(p: { userId: string }) { this.queue.trigger('customer', p.userId); }
  @OnEvent('marketing-trigger.order') order(p: { userId: string }) { this.queue.trigger('order', p.userId); }
  @OnEvent('marketing-trigger.customer-deleted') async deleted(p: { userId: string }) {
    await this.store.customerDeleted(p.userId).catch((e) => this.logger.error(`customer-deleted ${p.userId}: ${e}`));
  }
}
```

```ts
// application/workflow.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../../../../config/redis.config';
import { WorkflowEngine } from './workflow-engine.service';
import { WorkflowTriggers } from './workflow-triggers.service';

@Processor(QUEUES.MARKETING)
export class WorkflowProcessor extends WorkerHost {
  constructor(private readonly engine: WorkflowEngine, private readonly triggers: WorkflowTriggers) { super(); }
  async process(job: Job<{ enrollmentId?: string; kind?: 'customer' | 'order'; userId?: string }>): Promise<void> {
    if (job.name === 'step' && job.data.enrollmentId) return this.engine.process(job.data.enrollmentId);
    if (job.name === 'trigger' && job.data.kind && job.data.userId) return this.triggers.handle(job.data.kind, job.data.userId);
  }
}
```

```ts
// application/workflow-sweep.ts
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WorkflowStore } from '../infrastructure/workflow.store';
import { WorkflowQueue } from './workflow-queue';
import { WorkflowTriggers } from './workflow-triggers.service';

/** Off only with CRON_MARKETING_WORKFLOW_ENABLED=false|0 (no workflow is active until staff activates one). */
const enabled = () => !['false', '0'].includes((process.env.CRON_MARKETING_WORKFLOW_ENABLED ?? '').trim().toLowerCase());

/** Every minute: due waits, lost first jobs, stale webhook rows (backstop for Redis outages), scheduled triggers. */
@Injectable()
export class WorkflowSweep {
  private readonly logger = new Logger(WorkflowSweep.name);
  private running = false;
  constructor(private readonly store: WorkflowStore, private readonly queue: WorkflowQueue, private readonly triggers: WorkflowTriggers) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (!enabled() || this.running) return;
    this.running = true;
    try {
      for (const id of await this.store.dueEnrollmentIds(500)) this.queue.step(id);
      for (const id of await this.store.stalePendingWebhookIds(200)) this.queue.webhook(id);
      await this.triggers.runScheduled();
    } catch (e) {
      this.logger.error(`marketing workflow sweep: ${e instanceof Error ? e.stack : e}`);
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 7: josh-events signals — failing spec first**

In `josh-events.service.spec.ts` add (adapting to its `setup` helper; construct the service with a 4th argument `emitter`):

```ts
  it('signals marketing triggers after an applied customer / order snapshot, not after a stale one', async () => {
    const emitter = { emit: jest.fn() };
    const { svc } = setupWith({ emitter, storedVersion: null }); // build JoshEventsService(dataSource, undefined, undefined, emitter)
    await svc.apply({ type: 'customer.snapshot', aggregateId: U, version: '5', occurredAt: '', data: {} });
    expect(emitter.emit).toHaveBeenCalledWith('marketing-trigger.customer', { userId: U });
    const stale = setupWith({ emitter: { emit: jest.fn() }, storedVersion: '9' });
    await stale.svc.apply({ type: 'customer.snapshot', aggregateId: U, version: '5', occurredAt: '', data: {} });
    expect(stale.emitter.emit).not.toHaveBeenCalled();
  });
```
Write `setupWith` by copying the spec's existing setup (L4-16) and passing `emitter` as the 4th constructor argument; `U` is any uuid. Run it: expect FAIL.

Then in `josh-events.service.ts`:
- import `{ EventEmitter2 } from '@nestjs/event-emitter'`;
- add constructor param `@Optional() private readonly emitter?: EventEmitter2,` (last);
- change the three cases:

```ts
      case 'order.snapshot':
        return this.signalled('marketing-trigger.order', e.data?.order?.user_id,
          await this.guarded('josh_orders', 'orders_id', e, (m) => this.saveOrder(m, e)));
      case 'customer.snapshot':
        return this.signalled('marketing-trigger.customer', e.aggregateId, await this.guarded('josh_customers', 'id', e, (m) =>
          m.getRepository(JoshCustomerCopy).save({ id: e.aggregateId, data: e.data ?? {}, sourceVersion: e.version, deletedAt: null })));
```
and wrap the existing `customer.deleted` `return this.guarded(...)` the same way with `'marketing-trigger.customer-deleted'`, `e.aggregateId`. Add the helper:

```ts
  /** After commit: tell commerce's marketing workflows (local EventEmitter, no `type` so webhook dispatch ignores it). */
  private signalled(name: string, userId: unknown, result: ApplyResult): ApplyResult {
    if (result === 'applied' && typeof userId === 'string' && userId) this.emitter?.emit(name, { userId });
    return result;
  }
```
Run: `npx jest -c apps/commerce-platform/jest.config.cts josh-events` — expect PASS (old tests unchanged).

- [ ] **Step 8: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/marketing-workflow apps/commerce-platform/src/modules/integration/connector/josh/events
git commit -m "feat(marketing-workflow): triggers from josh snapshots (after activation only), scheduled runs, conversion, PDPA stop, sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: commerce — workflow service, analytics, admin API, module wiring

**Files:**
- Create: `.../application/workflow.service.ts`, `workflow-analytics.service.ts`, `.../presentation/workflow.schemas.ts`, `.../presentation/marketing-workflow.controller.ts`, `.../marketing-workflow.module.ts`
- Test: `.../application/workflow.service.spec.ts`
- Modify: `apps/commerce-platform/src/app.module.ts`, `apps/commerce-platform/.env.example`, `docs/event-contract.md`

**Interfaces:**
- Consumes: everything above; `MarketingTesters.assert(userId)` (`connector/josh/marketing-testers.ts`, exported by `JoshModule`); `parse` (growth.validation); `StaffRequest`, `StaffRoles`.
- Produces HTTP (prefix `/api`):
  - `GET marketing/flows` → `WorkflowListItem[]`
  - `GET marketing/flows/meta` → `WorkflowMeta` · `GET marketing/flows/segment-options` → `SegmentOption[]`
  - `POST marketing/flows/validate-expression` `{ expression }` → `{ ok: boolean; error?: string }`
  - `POST marketing/flows/webhook-test` `{ step }` → `WebhookTestResult`
  - `GET|POST marketing/flows/webhook-secrets`, `PUT|DELETE marketing/flows/webhook-secrets/:sid` (`{ name, value }` / `{ value }`) → `WebhookSecretItem[] | WebhookSecretItem`
  - `POST marketing/flows` `WorkflowInput` → `Workflow` · `GET|PUT|DELETE marketing/flows/:id`
  - `POST marketing/flows/:id/activate` → `Workflow` (422 `{ issues }` when invalid) · `POST marketing/flows/:id/pause`
  - `GET marketing/flows/:id/revisions` → `WorkflowRevision[]` · `GET marketing/flows/:id/analytics` → `WorkflowAnalytics`
  - `GET marketing/flows/:id/enrollments?page=1` → `{ rows: EnrollmentRow[]; total: number }` · `GET marketing/flows/:id/enrollments/:eid/logs` → `ActionLogRow[]`
  - `POST marketing/flows/:id/test-run` `{ userId, skipWaits }` → `{ enrollmentId: string | null }`

- [ ] **Step 1: zod schemas**

```ts
// presentation/workflow.schemas.ts
import { z } from 'zod';

const id = z.string().min(1).max(64);
const next = id.nullable();
const header = z.object({ key: z.string().max(200), value: z.string().max(2000) }).strict();
const webhookStep = z.object({ id, type: z.literal('webhook'), method: z.enum(['POST', 'PUT', 'PATCH', 'GET']), url: z.string().max(2048),
  headers: z.array(header).max(50), body: z.string().max(64 * 1024).optional(), nextId: next }).strict();
export const stepSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('audience'), segmentIds: z.array(z.string()).max(50).optional(), excludeSegmentIds: z.array(z.string()).max(50).optional(), nextId: next }).strict(),
  z.object({ id, type: z.literal('wait'), hours: z.number().int().min(0).max(100_000), minutes: z.number().int().min(0).max(59).optional(), nextId: next }).strict(),
  z.object({ id, type: z.literal('condition'), expression: z.string().max(2000), yesNextId: next, noNextId: next }).strict(),
  z.object({ id, type: z.literal('split'), branches: z.array(z.object({ id, label: z.string().max(80), percent: z.number(), nextId: next }).strict()).max(10) }).strict(),
  z.object({ id, type: z.literal('action'), nextId: next, action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('notify'), channels: z.array(z.enum(['push', 'email', 'in_app'])).max(3), templateKey: z.string().max(100), data: z.record(z.unknown()).optional() }).strict(),
    z.object({ kind: z.literal('grant_coupon'), couponId: z.string().max(64) }).strict(),
  ]) }).strict(),
  webhookStep,
]);
export const workflowInputSchema = z.object({
  name: z.string().max(200), triggerType: z.enum(['scheduled', 'order_milestone', 'first_login', 'app_login']),
  triggerConfig: z.record(z.unknown()), entryStepId: id.nullable(), steps: z.array(stepSchema).max(60),
  graphUi: z.record(z.object({ x: z.number(), y: z.number() })).nullable(), cooldownDays: z.number().int(), holdoutPercent: z.number().int(),
  conversionWindowDays: z.number().int(), exitOnGoal: z.object({ kind: z.literal('order_placed') }).nullable(),
  schedule: z.object({ timezone: z.string().max(64), daysOfWeek: z.array(z.number().int()).max(7).optional(), startTime: z.string().max(5).optional(),
    endTime: z.string().max(5).optional(), activeFrom: z.string().nullable().optional(), activeTo: z.string().nullable().optional() }).strict().nullable(),
}).strict();
export const expressionSchema = z.object({ expression: z.string().max(2000) }).strict();
export const webhookTestSchema = z.object({ step: webhookStep }).strict();
export const secretCreateSchema = z.object({ name: z.string().min(1).max(128), value: z.string().min(1).max(4000) }).strict();
export const secretReplaceSchema = z.object({ value: z.string().min(1).max(4000) }).strict();
export const testRunSchema = z.object({ userId: z.string().uuid(), skipWaits: z.boolean() }).strict();
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
```
If the repo's zod is v4 and `z.record(z.unknown())` needs a key schema, use `z.record(z.string(), z.unknown())` (check `growth.validation.ts` for the version's style).

- [ ] **Step 2: Failing service spec**

```ts
// application/workflow.service.spec.ts
import { UnprocessableEntityException } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const valid = { name: 'W', triggerType: 'first_login', triggerConfig: {}, entryStepId: id(1), graphUi: null, cooldownDays: 0, holdoutPercent: 0,
  conversionWindowDays: 7, exitOnGoal: null, schedule: null,
  steps: [{ id: id(1), type: 'action', action: { kind: 'notify', channels: ['push'], templateKey: 'custom_a' }, nextId: null }] };

function setup(row: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  const workflows = { save: jest.fn(async (r: Record<string, unknown>) => { const out = { id: 'wf1', status: 'draft', createdAt: new Date(), updatedAt: new Date(), ...row, ...r }; saved.push(out); return out; }),
    findOneBy: jest.fn(async () => row), find: jest.fn(async () => []), delete: jest.fn() };
  const revisions = { save: jest.fn(async (r: unknown) => r), find: jest.fn(async () => []) };
  const segments = { evaluableSegments: jest.fn(async () => [{ id: id(9), name: 'VIP', memberCount: 3 }]) };
  const svc = new WorkflowService(workflows as never, revisions as never, segments as never, { query: jest.fn(async () => []) } as never);
  return { svc, saved, revisions };
}

describe('WorkflowService', () => {
  it('saves a draft with issues and records a revision', async () => {
    const { svc, revisions } = setup();
    const wf = await svc.create({ ...valid, entryStepId: null } as never, 'a@x');
    expect(wf.issues.map((i) => i.code)).toContain('no_entry');
    expect(revisions.save).toHaveBeenCalledTimes(1);
  });
  it('refuses to activate an invalid flow with its issues', async () => {
    const { svc } = setup({ ...valid, id: 'wf1', status: 'draft', entryStepId: null });
    await expect(svc.activate('wf1', 'a@x')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
  it('activates and stamps activatedAt', async () => {
    const { svc, saved } = setup({ ...valid, id: 'wf1', status: 'draft' });
    await svc.activate('wf1', 'a@x');
    expect(saved.at(-1)).toMatchObject({ status: 'active', activatedAt: expect.any(Date) });
  });
  it('refuses an audience segment commerce cannot evaluate', async () => {
    const steps = [{ id: id(2), type: 'audience', segmentIds: [id(8)], nextId: id(1) }, ...valid.steps];
    const { svc } = setup({ ...valid, id: 'wf1', status: 'draft', steps, entryStepId: id(2) });
    await expect(svc.activate('wf1', 'a@x')).rejects.toMatchObject({ response: { issues: [expect.objectContaining({ code: 'audience_segment' })] } });
  });
  it('keeps an active workflow valid on update', async () => {
    const { svc } = setup({ ...valid, id: 'wf1', status: 'active' });
    await expect(svc.update('wf1', { ...valid, entryStepId: null } as never, 'a@x')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx jest -c apps/commerce-platform/jest.config.cts workflow.service`

- [ ] **Step 4: Implement services**

```ts
// application/workflow.service.ts
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { assertPublicHttpUrl } from '../../../../shared-kernel/infrastructure/public-url';
import { SegmentsService } from '../../segments/segments.service';
import { MARKETING_EXPRESSION_FIELD_TYPES } from '../domain/expression.parser';
import { FIELD_LABELS, SUPPORTED_FIELDS } from '../domain/expression.fields';
import { TEMPLATE_VARS } from '../domain/template';
import { validateWorkflow } from '../domain/workflow.validator';
import { LIMITS } from '../domain/workflow.types';
import type { Workflow, WorkflowInput, WorkflowIssue, WorkflowListItem, WorkflowMeta, WorkflowRevision } from '../domain/workflow.types';
import { MarketingWorkflowRevisionRow } from '../infrastructure/marketing-workflow-revision.entity';
import { MarketingWorkflowRow } from '../infrastructure/marketing-workflow.entity';

const INPUT_KEYS = ['name', 'triggerType', 'triggerConfig', 'entryStepId', 'steps', 'graphUi', 'cooldownDays', 'holdoutPercent',
  'conversionWindowDays', 'exitOnGoal', 'schedule'] as const;
const inputOf = (r: MarketingWorkflowRow): WorkflowInput => Object.fromEntries(INPUT_KEYS.map((k) => [k, r[k]])) as unknown as WorkflowInput;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class WorkflowService {
  constructor(
    @InjectRepository(MarketingWorkflowRow) private readonly workflows: Repository<MarketingWorkflowRow>,
    @InjectRepository(MarketingWorkflowRevisionRow) private readonly revisions: Repository<MarketingWorkflowRevisionRow>,
    private readonly segments: SegmentsService,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  meta(): WorkflowMeta {
    return {
      limits: { maxWaitSteps: LIMITS.maxWaitSteps, maxConditionSteps: LIMITS.maxConditionSteps, maxAudienceSteps: LIMITS.maxAudienceSteps,
        maxWaitMinutes: LIMITS.maxWaitMinutes, maxHeaders: LIMITS.maxHeaders, maxBodyBytes: LIMITS.maxBodyBytes,
        minSplitBranches: LIMITS.minSplitBranches, maxSplitBranches: LIMITS.maxSplitBranches },
      expressionFields: SUPPORTED_FIELDS.map((field) => ({ field, type: MARKETING_EXPRESSION_FIELD_TYPES[field], label: FIELD_LABELS[field] })),
      templateVars: TEMPLATE_VARS.map((v) => ({ ...v })),
    };
  }

  segmentOptions() { return this.segments.evaluableSegments(); }

  async list(): Promise<WorkflowListItem[]> {
    return (await this.db.query(`SELECT w.id, w.name, w.status, w.trigger_type, w.updated_at,
        count(e.id) FILTER (WHERE NOT e.is_test)::int AS enrolled, count(e.converted_at) FILTER (WHERE NOT e.is_test)::int AS converted
      FROM marketing_workflows w LEFT JOIN marketing_workflow_enrollments e ON e.workflow_id = w.id AND e.started_at >= now() - interval '30 days'
      GROUP BY w.id ORDER BY (w.status = 'active') DESC, w.updated_at DESC`))
      .map((r: Record<string, unknown>) => ({ id: r.id, name: r.name, status: r.status, triggerType: r.trigger_type,
        updatedAt: iso(r.updated_at as Date), enrolled30d: r.enrolled, converted30d: r.converted }) as WorkflowListItem);
  }

  async get(id: string): Promise<Workflow> { return this.toDto(await this.row(id)); }

  async create(input: WorkflowInput, actor: string): Promise<Workflow> {
    const row = await this.workflows.save({ ...input, status: 'draft', createdBy: actor, updatedBy: actor });
    await this.revisions.save({ workflowId: row.id, snapshot: inputOf(row as MarketingWorkflowRow), createdBy: actor });
    return this.toDto(row as MarketingWorkflowRow);
  }

  /** An active workflow must stay valid: edits apply to live enrollments. */
  async update(id: string, input: WorkflowInput, actor: string): Promise<Workflow> {
    const row = await this.row(id);
    if (row.status === 'active') await this.assertActivatable({ ...row, ...input } as MarketingWorkflowRow);
    const saved = await this.workflows.save({ ...row, ...input, updatedBy: actor });
    await this.revisions.save({ workflowId: id, snapshot: inputOf(saved as MarketingWorkflowRow), createdBy: actor });
    return this.toDto(saved as MarketingWorkflowRow);
  }

  async activate(id: string, actor: string): Promise<Workflow> {
    const row = await this.row(id);
    await this.assertActivatable(row);
    return this.toDto(await this.workflows.save({ ...row, status: 'active', activatedAt: new Date(), updatedBy: actor }) as MarketingWorkflowRow);
  }

  async pause(id: string, actor: string): Promise<Workflow> {
    const row = await this.row(id);
    return this.toDto(await this.workflows.save({ ...row, status: 'paused', updatedBy: actor }) as MarketingWorkflowRow);
  }

  async remove(id: string): Promise<void> {
    const row = await this.row(id);
    if (row.status === 'active') throw new BadRequestException('หยุด workflow ก่อนลบ');
    await this.workflows.delete({ id });
  }

  async revisionsOf(id: string): Promise<WorkflowRevision[]> {
    return (await this.revisions.find({ where: { workflowId: id }, order: { createdAt: 'DESC' }, take: 50 }))
      .map((r) => ({ id: r.id, createdBy: r.createdBy, createdAt: iso(r.createdAt)!, snapshot: r.snapshot }));
  }

  /** Pure rules + what needs IO: audiences commerce can evaluate, static webhook URLs that are public. */
  async issuesOf(row: MarketingWorkflowRow): Promise<WorkflowIssue[]> {
    const issues = validateWorkflow(inputOf(row));
    const evaluable = new Set((await this.segments.evaluableSegments()).map((s) => s.id));
    for (const s of row.steps) {
      if (s.type === 'audience' && [...(s.segmentIds ?? []), ...(s.excludeSegmentIds ?? [])].some((x) => !evaluable.has(x)))
        issues.push({ stepId: s.id, code: 'audience_segment', message: 'segment นี้ใช้กับ workflow ของ commerce ไม่ได้' });
      if (s.type === 'webhook' && !s.url.includes('{{')) {
        await assertPublicHttpUrl(s.url).catch(() => issues.push({ stepId: s.id, code: 'webhook_blocked', message: 'URL นี้ชี้ไปที่เครือข่ายภายในหรือหาไม่เจอ' }));
      }
    }
    return issues;
  }

  async row(id: string): Promise<MarketingWorkflowRow> {
    const row = await this.workflows.findOneBy({ id });
    if (!row) throw new NotFoundException('ไม่พบ workflow');
    return row;
  }

  private async assertActivatable(row: MarketingWorkflowRow) {
    const issues = await this.issuesOf(row);
    if (issues.length) throw new UnprocessableEntityException({ message: 'workflow ยังไม่พร้อมเปิดใช้', issues });
  }

  private async toDto(r: MarketingWorkflowRow): Promise<Workflow> {
    return { ...inputOf(r), id: r.id, status: r.status, activatedAt: iso(r.activatedAt), createdBy: r.createdBy, updatedBy: r.updatedBy,
      createdAt: iso(r.createdAt)!, updatedAt: iso(r.updatedAt)!, issues: await this.issuesOf(r) };
  }
}
```
Note `toDto` resolves DNS for static webhook URLs on every read; that is a few lookups per editor load and fine for phase 1.

```ts
// application/workflow-analytics.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ActionLogRow, EnrollmentRow, WorkflowAnalytics, WorkflowStep } from '../domain/workflow.types';

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** Results for one commerce workflow; test runs never count. */
@Injectable()
export class WorkflowAnalyticsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async analytics(workflowId: string, steps: WorkflowStep[]): Promise<WorkflowAnalytics> {
    const [c] = await this.db.query(`SELECT count(*)::int AS enrolled,
        count(*) FILTER (WHERE status = 'running' OR status = 'pending')::int AS running, count(*) FILTER (WHERE status = 'completed' AND NOT is_holdout)::int AS completed,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped, count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(converted_at)::int AS converted, count(*) FILTER (WHERE is_holdout)::int AS holdout,
        count(*) FILTER (WHERE NOT is_holdout)::int AS treated, count(converted_at) FILTER (WHERE is_holdout)::int AS holdout_converted,
        count(converted_at) FILTER (WHERE NOT is_holdout)::int AS treated_converted
      FROM marketing_workflow_enrollments WHERE workflow_id = $1 AND NOT is_test`, [workflowId]);
    const actions = await this.db.query(`SELECT l.kind, l.status, count(*)::int AS count FROM marketing_workflow_action_logs l
      JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id WHERE e.workflow_id = $1 AND NOT e.is_test AND l.kind NOT IN ('split', 'condition')
      GROUP BY 1, 2 ORDER BY 1, 2`, [workflowId]);
    const split = await this.db.query(`SELECT l.step_id, l.meta->>'branchId' AS branch_id, count(DISTINCT e.id)::int AS entered,
        count(DISTINCT e.id) FILTER (WHERE e.converted_at IS NOT NULL)::int AS converted
      FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
      WHERE e.workflow_id = $1 AND NOT e.is_test AND l.kind = 'split' GROUP BY 1, 2`, [workflowId]);
    const splits = steps.filter((s): s is Extract<WorkflowStep, { type: 'split' }> => s.type === 'split').map((s) => ({
      stepId: s.id,
      branches: s.branches.map((b) => {
        const hit = split.find((r: Record<string, unknown>) => r.step_id === s.id && r.branch_id === b.id);
        return { branchId: b.id, label: b.label, entered: hit?.entered ?? 0, converted: hit?.converted ?? 0 };
      }),
    }));
    return {
      counts: { enrolled: c.enrolled, running: c.running, completed: c.completed, skipped: c.skipped, failed: c.failed, converted: c.converted, holdout: c.holdout },
      actions, splits,
      holdout: { enrolled: c.holdout, converted: c.holdout_converted }, treated: { enrolled: c.treated, converted: c.treated_converted },
    };
  }

  async enrollments(workflowId: string, page: number): Promise<{ rows: EnrollmentRow[]; total: number }> {
    const rows = await this.db.query(`SELECT *, count(*) OVER ()::int AS total FROM marketing_workflow_enrollments WHERE workflow_id = $1
      ORDER BY started_at DESC LIMIT 50 OFFSET $2`, [workflowId, (page - 1) * 50]);
    return {
      total: rows[0]?.total ?? 0,
      rows: rows.map((r: Record<string, unknown>) => ({ id: r.id, userId: r.user_id, status: r.status, occurrenceKey: r.occurrence_key,
        currentStepId: r.current_step_id, resumeAt: iso(r.resume_at), isHoldout: r.is_holdout, isTest: r.is_test, startedAt: iso(r.started_at),
        completedAt: iso(r.completed_at), endReason: r.end_reason, convertedAt: iso(r.converted_at) }) as EnrollmentRow),
    };
  }

  async logs(workflowId: string, enrollmentId: string): Promise<ActionLogRow[]> {
    const rows = await this.db.query(`SELECT l.* FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
      WHERE e.workflow_id = $1 AND e.id = $2 ORDER BY l.created_at`, [workflowId, enrollmentId]);
    return rows.map((r: Record<string, unknown>) => ({ id: r.id, stepId: r.step_id, kind: r.kind, status: r.status, meta: r.meta, createdAt: iso(r.created_at) }) as ActionLogRow);
  }
}
```

- [ ] **Step 5: Controller + module**

```ts
// presentation/marketing-workflow.controller.ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UnprocessableEntityException } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { parse } from '../../growth/growth.validation';
import { MarketingTesters } from '../../connector/josh/marketing-testers';
import { checkExpression } from '../domain/expression.fields';
import { renderWebhook, secretIdsOf, webhookVars } from '../domain/template';
import type { WorkflowInput, WorkflowStep, WebhookTestResult } from '../domain/workflow.types';
import { sendWebhook, WebhookSendError } from '../application/webhook-send';
import { WebhookSecretsService } from '../application/webhook-secrets.service';
import { WorkflowAnalyticsService } from '../application/workflow-analytics.service';
import { WorkflowEngine } from '../application/workflow-engine.service';
import { WorkflowService } from '../application/workflow.service';
import { expressionSchema, pageSchema, secretCreateSchema, secretReplaceSchema, testRunSchema, webhookTestSchema, workflowInputSchema } from './workflow.schemas';

const SAMPLE = { first_name: 'สมชาย', last_name: 'ใจดี', email: 'sample@example.com', mobile_phone: '0800000000', custype: 'RESTAURANT', cuisine_name: 'ไทย' };

/** Commerce-run marketing workflows (spec 2026-10-10 §4.8). Static routes before `:id`. */
@Controller('marketing/flows')
@StaffRoles('marketing')
export class MarketingWorkflowController {
  constructor(private readonly flows: WorkflowService, private readonly analytics: WorkflowAnalyticsService, private readonly engine: WorkflowEngine,
    private readonly secrets: WebhookSecretsService, private readonly testers: MarketingTesters) {}

  @Get() list() { return this.flows.list(); }
  @Get('meta') meta() { return this.flows.meta(); }
  @Get('segment-options') segmentOptions() { return this.flows.segmentOptions(); }
  @Post('validate-expression') validateExpression(@Body() b: unknown) {
    const r = checkExpression(parse(expressionSchema, b).expression);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  @Post('webhook-test') async webhookTest(@Body() b: unknown): Promise<WebhookTestResult> {
    const step = parse(webhookTestSchema, b).step as Extract<WorkflowStep, { type: 'webhook' }>;
    const req = renderWebhook(step, webhookVars(SAMPLE, { userId: '00000000-0000-4000-8000-000000000000', workflowId: 'test', workflowName: 'test', enrollmentId: 'test', stepId: step.id }));
    try {
      return await sendWebhook(req, await this.secrets.resolve(secretIdsOf(req.headers)));
    } catch (e) {
      const err = e instanceof WebhookSendError ? e : new WebhookSendError('send_failed', false);
      return { status: err.status, body: '', error: err.code };
    }
  }
  @Get('webhook-secrets') listSecrets() { return this.secrets.list(); }
  @Post('webhook-secrets') createSecret(@Body() b: unknown, @Req() r: StaffRequest) { const x = parse(secretCreateSchema, b); return this.secrets.create(x.name, x.value, r.staff.email); }
  @Put('webhook-secrets/:sid') replaceSecret(@Param('sid', ParseUUIDPipe) sid: string, @Body() b: unknown) { return this.secrets.replace(sid, parse(secretReplaceSchema, b).value); }
  @Delete('webhook-secrets/:sid') removeSecret(@Param('sid', ParseUUIDPipe) sid: string) { return this.secrets.remove(sid); }

  @Post() create(@Body() b: unknown, @Req() r: StaffRequest) { return this.flows.create(parse(workflowInputSchema, b) as unknown as WorkflowInput, r.staff.email); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.flows.get(id); }
  @Put(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Req() r: StaffRequest) {
    return this.flows.update(id, parse(workflowInputSchema, b) as unknown as WorkflowInput, r.staff.email);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.flows.remove(id); }
  @Post(':id/activate') activate(@Param('id', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.flows.activate(id, r.staff.email); }
  @Post(':id/pause') pause(@Param('id', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.flows.pause(id, r.staff.email); }
  @Get(':id/revisions') revisions(@Param('id', ParseUUIDPipe) id: string) { return this.flows.revisionsOf(id); }
  @Get(':id/analytics') async stats(@Param('id', ParseUUIDPipe) id: string) { return this.analytics.analytics(id, (await this.flows.row(id)).steps); }
  @Get(':id/enrollments') enrollments(@Param('id', ParseUUIDPipe) id: string, @Query() q: unknown) { return this.analytics.enrollments(id, parse(pageSchema, q).page); }
  @Get(':id/enrollments/:eid/logs') logs(@Param('id', ParseUUIDPipe) id: string, @Param('eid', ParseUUIDPipe) eid: string) { return this.analytics.logs(id, eid); }

  /** Real sends to one tester only (spec §4.8); the flow must be valid. */
  @Post(':id/test-run') async testRun(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const x = parse(testRunSchema, b);
    await this.testers.assert(x.userId);
    const row = await this.flows.row(id);
    const issues = await this.flows.issuesOf(row);
    if (issues.length) throw new UnprocessableEntityException({ message: 'workflow ยังไม่พร้อม', issues });
    return { enrollmentId: await this.engine.enroll(row, x.userId, `test:${Date.now()}`, { test: true, skipWaits: x.skipWaits }) };
  }
}
```

```ts
// marketing-workflow.module.ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUES } from '../../../config/redis.config';
import { SettingsModule } from '../../core/settings/settings.module';
import { JoshModule } from '../connector/josh/josh.module';
import { SegmentsModule } from '../segments/segments.module';
import { WebhookDelivery } from '../webhook-subscription/infrastructure/webhook-delivery.entity';
import { MarketingWebhookWorker } from './application/marketing-webhook.worker';
import { WebhookSecretsService } from './application/webhook-secrets.service';
import { WorkflowAnalyticsService } from './application/workflow-analytics.service';
import { WorkflowEngine } from './application/workflow-engine.service';
import { WorkflowProcessor } from './application/workflow.processor';
import { WorkflowQueue } from './application/workflow-queue';
import { WorkflowService } from './application/workflow.service';
import { WorkflowSweep } from './application/workflow-sweep';
import { WorkflowTriggerListener } from './application/workflow-trigger.listener';
import { WorkflowTriggers } from './application/workflow-triggers.service';
import { MarketingWebhookSecret } from './infrastructure/marketing-webhook-secret.entity';
import { MarketingWorkflowRevisionRow } from './infrastructure/marketing-workflow-revision.entity';
import { MarketingWorkflowRow } from './infrastructure/marketing-workflow.entity';
import { WorkflowStore } from './infrastructure/workflow.store';
import { MarketingWorkflowController } from './presentation/marketing-workflow.controller';

/** Commerce-run marketing workflows, phase 1 (spec 2026-10-10). */
@Module({
  imports: [
    TypeOrmModule.forFeature([MarketingWorkflowRow, MarketingWorkflowRevisionRow, MarketingWebhookSecret, WebhookDelivery]),
    BullModule.registerQueue({ name: QUEUES.MARKETING }, { name: QUEUES.MARKETING_WEBHOOK }),
    SegmentsModule, SettingsModule, JoshModule,
  ],
  controllers: [MarketingWorkflowController],
  providers: [WorkflowStore, WorkflowQueue, WorkflowEngine, WorkflowTriggers, WorkflowTriggerListener, WorkflowProcessor, WorkflowSweep,
    MarketingWebhookWorker, WebhookSecretsService, WorkflowService, WorkflowAnalyticsService],
})
export class MarketingWorkflowModule {}
```
Check `settings.module.ts` exports `SettingsService` and `segments.module.ts` exports `SegmentsService` (both confirmed in research). Register `MarketingWorkflowModule` in `app.module.ts` next to `SegmentsModule` (import line + `imports[]` entry).

- [ ] **Step 6: Env, event contract**

`apps/commerce-platform/.env.example` — append:
```
# Commerce marketing workflows (phase 1): AES-256-GCM key for webhook header secrets (32 bytes, base64: `openssl rand -base64 32`).
MARKETING_WEBHOOK_SECRETS_KEY=
# Minute sweep (due waits, lost jobs, scheduled triggers). Default on; set false to stop commerce workflows from running.
CRON_MARKETING_WORKFLOW_ENABLED=true
```
`docs/event-contract.md` §5 (next to `winback.notify`, ~L110-127): add rows for `marketing.notify` (payload as Task 1 Interfaces, handler `CommerceMarketingEventsService.notify`, outcome strings) and `marketing.grant_coupon`, plus one line: "Turn on by adding both types to the josh subscription with `ops/scripts/josh-subscription.cjs` (`SCRIPT_ARGS='add=marketing.notify,marketing.grant_coupon'`) only after josh with the receiver is deployed — josh 422s unknown types and commerce dead-letters 4xx." Follow that file's table format.

- [ ] **Step 7: Run all commerce tests + typecheck**

```bash
npx jest -c apps/commerce-platform/jest.config.cts marketing-workflow segments josh-events webhook architecture
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
npx nx test commerce-platform
```
Expected: all pass (the architecture spec checks dependency direction: integration → core/commerce/platform only).

- [ ] **Step 8: Commit**

```bash
git add apps/commerce-platform docs/event-contract.md
git commit -m "feat(marketing-workflow): admin API — CRUD, activate with checks, analytics, enrollments, tester test-run, webhook test, secrets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: commerce-admin — API client + pure graph edits

**Files:**
- Modify: `apps/commerce-admin/src/lib/api.ts`
- Create: `apps/commerce-admin/src/app/pages/marketing-workflow/workflow-graph.ts`, `workflow-graph.spec.ts`

**Interfaces:**
- Consumes: HTTP API (Task 8), types `@cp/marketing-workflow`.
- Produces:
  - `flowsApi = { list, meta, segmentOptions, validateExpression(expression), webhookTest(step), secrets: { list, create(name, value), replace(id, value), remove(id) }, create(input), get(id), update(id, input), remove(id), activate(id), pause(id), revisions(id), analytics(id), enrollments(id, page), logs(id, eid), testRun(id, userId, skipWaits) }`
  - `TRIGGER = 'trigger'`; `type StepKind = 'audience' | 'wait' | 'condition' | 'split' | 'push' | 'email' | 'in_app' | 'webhook' | 'grant_coupon'`; `interface Anchor { stepId: string; port?: string }` (`stepId === TRIGGER` for the entry; `port`: `'yes' | 'no' | <branchId>`)
  - `newStep(kind, newId?)`, `outPorts(step)` → `{ port?: string; label: string; target: string | null }[]`, `targetOf(g, anchor)`, `insertAfter(g, anchor, step)`, `addLoose(g, step)`, `connect(g, from, to)`, `disconnect(g, from)`, `removeStep(g, id)`, `firstFreePort(g, stepId)`, `tailOfMain(g)`, `autoLayout(g)`; `type Graph = { entryStepId: string | null; steps: WorkflowStep[] }`

- [ ] **Step 1: API client** — append to `src/lib/api.ts` (near `marketingTestersApi`):

```ts
import type { ActionLogRow, EnrollmentRow, SegmentOption, WebhookSecretItem, WebhookTestResult, Workflow, WorkflowAnalytics,
  WorkflowInput, WorkflowListItem, WorkflowMeta, WorkflowRevision, WorkflowStep } from '@cp/marketing-workflow';

/** Commerce-run marketing workflows (commerce-platform /marketing/flows). */
export const flowsApi = {
  list: () => api.get<WorkflowListItem[]>('/marketing/flows'),
  meta: () => api.get<WorkflowMeta>('/marketing/flows/meta'),
  segmentOptions: () => api.get<SegmentOption[]>('/marketing/flows/segment-options'),
  validateExpression: (expression: string) => api.post<{ ok: boolean; error?: string }>('/marketing/flows/validate-expression', { expression }),
  webhookTest: (step: Extract<WorkflowStep, { type: 'webhook' }>) => api.post<WebhookTestResult>('/marketing/flows/webhook-test', { step }),
  secrets: {
    list: () => api.get<WebhookSecretItem[]>('/marketing/flows/webhook-secrets'),
    create: (name: string, value: string) => api.post<WebhookSecretItem>('/marketing/flows/webhook-secrets', { name, value }),
    replace: (id: string, value: string) => api.put<WebhookSecretItem>(`/marketing/flows/webhook-secrets/${id}`, { value }),
    remove: (id: string) => api.del<void>(`/marketing/flows/webhook-secrets/${id}`),
  },
  create: (input: WorkflowInput) => api.post<Workflow>('/marketing/flows', input),
  get: (id: string) => api.get<Workflow>(`/marketing/flows/${id}`),
  update: (id: string, input: WorkflowInput) => api.put<Workflow>(`/marketing/flows/${id}`, input),
  remove: (id: string) => api.del<void>(`/marketing/flows/${id}`),
  activate: (id: string) => api.post<Workflow>(`/marketing/flows/${id}/activate`, {}),
  pause: (id: string) => api.post<Workflow>(`/marketing/flows/${id}/pause`, {}),
  revisions: (id: string) => api.get<WorkflowRevision[]>(`/marketing/flows/${id}/revisions`),
  analytics: (id: string) => api.get<WorkflowAnalytics>(`/marketing/flows/${id}/analytics`),
  enrollments: (id: string, page: number) => api.get<{ rows: EnrollmentRow[]; total: number }>(`/marketing/flows/${id}/enrollments?page=${page}`),
  logs: (id: string, eid: string) => api.get<ActionLogRow[]>(`/marketing/flows/${id}/enrollments/${eid}/logs`),
  testRun: (id: string, userId: string, skipWaits: boolean) => api.post<{ enrollmentId: string | null }>(`/marketing/flows/${id}/test-run`, { userId, skipWaits }),
};
```
Put the `import type` with the file's other imports at the top. Check `api.put`/`api.del` names in `api` (research: `{ get, post, patch, put, del }`).

- [ ] **Step 2: Failing graph spec**

```ts
// app/pages/marketing-workflow/workflow-graph.spec.ts
import { describe, expect, it } from 'vitest';
import { addLoose, autoLayout, connect, disconnect, firstFreePort, insertAfter, newStep, removeStep, tailOfMain, targetOf, TRIGGER, type Graph } from './workflow-graph';

let n = 0;
const fresh = (kind: Parameters<typeof newStep>[0]) => newStep(kind, `id${++n}`);
const empty: Graph = { entryStepId: null, steps: [] };

describe('workflow-graph', () => {
  it('inserts after the trigger, then between two steps', () => {
    const a = fresh('push'); const b = fresh('email');
    let g = insertAfter(empty, { stepId: TRIGGER }, a);
    expect(g.entryStepId).toBe(a.id);
    g = insertAfter(g, { stepId: TRIGGER }, b);
    expect(g.entryStepId).toBe(b.id);
    expect(targetOf(g, { stepId: b.id })).toBe(a.id);
  });

  it('inserts on a condition / split port and chains the old target behind the new step', () => {
    const c = fresh('condition'); const x = fresh('push'); const y = fresh('webhook');
    let g = insertAfter(empty, { stepId: TRIGGER }, c);
    g = insertAfter(g, { stepId: c.id, port: 'no' }, x);
    g = insertAfter(g, { stepId: c.id, port: 'no' }, y);
    expect(targetOf(g, { stepId: c.id, port: 'no' })).toBe(y.id);
    expect(targetOf(g, { stepId: y.id })).toBe(x.id);
    expect(firstFreePort(g, c.id)).toEqual({ stepId: c.id, port: 'yes' });
    const s = fresh('split');
    g = insertAfter(g, { stepId: c.id, port: 'yes' }, s);
    const branchB = (g.steps.find((st) => st.id === s.id) as { branches: { id: string }[] }).branches[1].id;
    expect(firstFreePort(g, s.id)).toEqual({ stepId: s.id, port: branchB });
  });

  it('removes a step and reconnects around single-exit steps', () => {
    const a = fresh('push'); const b = fresh('wait'); const c = fresh('email');
    let g = insertAfter(insertAfter(insertAfter(empty, { stepId: TRIGGER }, c), { stepId: TRIGGER }, b), { stepId: TRIGGER }, a);
    g = removeStep(g, b.id);
    expect(targetOf(g, { stepId: a.id })).toBe(c.id);
    g = removeStep(g, a.id);
    expect(g.entryStepId).toBe(c.id);
  });

  it('connect refuses self-loops; disconnect clears a port; loose steps stay unconnected', () => {
    const a = fresh('push');
    let g = addLoose(empty, a);
    expect(g.entryStepId).toBeNull();
    expect(connect(g, { stepId: a.id }, a.id)).toBe(g);
    g = connect(g, { stepId: TRIGGER }, a.id);
    expect(g.entryStepId).toBe(a.id);
    expect(disconnect(g, { stepId: TRIGGER }).entryStepId).toBeNull();
  });

  it('finds the end of the main path and lays out by depth', () => {
    const a = fresh('push'); const b = fresh('email');
    const g = insertAfter(insertAfter(empty, { stepId: TRIGGER }, b), { stepId: TRIGGER }, a);
    expect(tailOfMain(g)).toEqual({ stepId: b.id, port: undefined });
    const pos = autoLayout(g);
    expect(pos[TRIGGER].x).toBeLessThan(pos[a.id].x);
    expect(pos[a.id].x).toBeLessThan(pos[b.id].x);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run apps/commerce-admin/src/app/pages/marketing-workflow/workflow-graph.spec.ts --config apps/commerce-admin/vite.config.mts`

- [ ] **Step 4: Implement**

```ts
// app/pages/marketing-workflow/workflow-graph.ts
import type { CanvasPosition, WorkflowStep } from '@cp/marketing-workflow';

/** Pure edits of a workflow's graph. Every pointer is explicit (`nextId` etc.); the entry is `entryStepId`. */
export const TRIGGER = 'trigger';
export type StepKind = 'audience' | 'wait' | 'condition' | 'split' | 'push' | 'email' | 'in_app' | 'webhook' | 'grant_coupon';
export interface Anchor { stepId: string; port?: string }
export interface Graph { entryStepId: string | null; steps: WorkflowStep[] }

const uuid = () => crypto.randomUUID();

export function newStep(kind: StepKind, newId: string = uuid()): WorkflowStep {
  switch (kind) {
    case 'audience': return { id: newId, type: 'audience', segmentIds: [], excludeSegmentIds: [], nextId: null };
    case 'wait': return { id: newId, type: 'wait', hours: 1, minutes: 0, nextId: null };
    case 'condition': return { id: newId, type: 'condition', expression: 'still_no_order == true', yesNextId: null, noNextId: null };
    case 'split': return { id: newId, type: 'split', branches: [
      { id: uuid(), label: 'A', percent: 50, nextId: null }, { id: uuid(), label: 'B', percent: 50, nextId: null }] };
    case 'webhook': return { id: newId, type: 'webhook', method: 'POST', url: '', headers: [], body: '', nextId: null };
    case 'grant_coupon': return { id: newId, type: 'action', action: { kind: 'grant_coupon', couponId: '' }, nextId: null };
    default: return { id: newId, type: 'action', action: { kind: 'notify', channels: [kind], templateKey: '' }, nextId: null };
  }
}

export function outPorts(step: WorkflowStep): { port?: string; label: string; target: string | null }[] {
  if (step.type === 'condition') return [{ port: 'yes', label: 'Yes', target: step.yesNextId }, { port: 'no', label: 'No', target: step.noNextId }];
  if (step.type === 'split') return step.branches.map((b) => ({ port: b.id, label: `${b.label} ${b.percent}%`, target: b.nextId }));
  return [{ port: undefined, label: '', target: step.nextId }];
}

const find = (g: Graph, id: string) => g.steps.find((s) => s.id === id);

export function targetOf(g: Graph, a: Anchor): string | null {
  if (a.stepId === TRIGGER) return g.entryStepId;
  const s = find(g, a.stepId);
  if (!s) return null;
  return outPorts(s).find((p) => p.port === a.port)?.target ?? (a.port === undefined ? outPorts(s)[0]?.target ?? null : null);
}

function withTarget(step: WorkflowStep, port: string | undefined, target: string | null): WorkflowStep {
  if (step.type === 'condition') return port === 'no' ? { ...step, noNextId: target } : { ...step, yesNextId: target };
  if (step.type === 'split') {
    const branchId = port ?? step.branches[0]?.id;
    return { ...step, branches: step.branches.map((b) => (b.id === branchId ? { ...b, nextId: target } : b)) };
  }
  return { ...step, nextId: target };
}

function setTarget(g: Graph, a: Anchor, target: string | null): Graph {
  if (a.stepId === TRIGGER) return { ...g, entryStepId: target };
  return { ...g, steps: g.steps.map((s) => (s.id === a.stepId ? withTarget(s, a.port, target) : s)) };
}

/** New step goes on the anchor's port; whatever was there continues from the new step's first port. */
export function insertAfter(g: Graph, a: Anchor, step: WorkflowStep): Graph {
  const old = targetOf(g, a);
  const chained = withTarget(step, undefined, old);
  return setTarget({ ...g, steps: [...g.steps, chained] }, a, step.id);
}

export const addLoose = (g: Graph, step: WorkflowStep): Graph => ({ ...g, steps: [...g.steps, step] });

export function connect(g: Graph, from: Anchor, to: string): Graph {
  if (from.stepId === to || to === TRIGGER || !find(g, to)) return g;
  return setTarget(g, from, to);
}

export const disconnect = (g: Graph, from: Anchor): Graph => setTarget(g, from, null);

/** Pointers into the removed step move to its target when it has a single exit; otherwise they end (null). */
export function removeStep(g: Graph, id: string): Graph {
  const gone = find(g, id);
  if (!gone) return g;
  const ports = outPorts(gone);
  const through = ports.length === 1 ? ports[0].target : null;
  const repoint = (t: string | null) => (t === id ? through : t);
  const steps = g.steps.filter((s) => s.id !== id).map((s) => {
    if (s.type === 'condition') return { ...s, yesNextId: repoint(s.yesNextId), noNextId: repoint(s.noNextId) };
    if (s.type === 'split') return { ...s, branches: s.branches.map((b) => ({ ...b, nextId: repoint(b.nextId) })) };
    return { ...s, nextId: repoint(s.nextId) };
  });
  return { entryStepId: repoint(g.entryStepId), steps };
}

export function firstFreePort(g: Graph, stepId: string): Anchor | null {
  if (stepId === TRIGGER) return g.entryStepId ? null : { stepId };
  const s = find(g, stepId);
  const free = s ? outPorts(s).find((p) => p.target === null) : undefined;
  return free ? { stepId, port: free.port } : null;
}

/** Follow first ports from the trigger to the last step (where a click in the palette appends). */
export function tailOfMain(g: Graph): Anchor {
  let anchor: Anchor = { stepId: TRIGGER };
  const seen = new Set<string>();
  for (let next = g.entryStepId; next && !seen.has(next); ) {
    seen.add(next);
    const s = find(g, next);
    if (!s) break;
    const port = outPorts(s)[0];
    anchor = { stepId: s.id, port: port.port };
    next = port.target;
  }
  return anchor;
}

const COL = 300; const ROW = 140;
/** Columns by BFS depth from the trigger, rows in visit order; unreachable steps go in a row below. */
export function autoLayout(g: Graph): Record<string, CanvasPosition> {
  const pos: Record<string, CanvasPosition> = { [TRIGGER]: { x: 0, y: 0 } };
  const rows = new Map<number, number>();
  const queue: [string, number][] = g.entryStepId ? [[g.entryStepId, 1]] : [];
  while (queue.length) {
    const [id, depth] = queue.shift()!;
    if (pos[id]) continue;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    pos[id] = { x: depth * COL, y: row * ROW };
    const s = find(g, id);
    if (s) for (const p of outPorts(s)) if (p.target) queue.push([p.target, depth + 1]);
  }
  const deepest = Math.max(0, ...[...rows.values()]);
  g.steps.filter((s) => !pos[s.id]).forEach((s, i) => { pos[s.id] = { x: (i + 1) * COL, y: (deepest + 1) * ROW }; });
  return pos;
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run apps/commerce-admin/src/app/pages/marketing-workflow/workflow-graph.spec.ts --config apps/commerce-admin/vite.config.mts`

- [ ] **Step 6: Commit**

```bash
git add apps/commerce-admin/src/lib/api.ts apps/commerce-admin/src/app/pages/marketing-workflow
git commit -m "feat(admin): marketing flows API client and pure graph edits (insert, connect, remove, layout)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: commerce-admin — palette, node cards, canvas (drag-drop, `+`, click)

**Files:**
- Create: `app/pages/marketing-workflow/palette.ts`, `Palette.tsx`, `NodeCard.tsx`, `FlowCanvas.tsx`
- Test: `app/pages/marketing-workflow/palette.spec.ts`

**Interfaces:**
- Consumes: `workflow-graph.ts` (Task 9), `WorkflowMeta['limits']`.
- Produces:
  - `PALETTE: { category: 'entry' | 'channel' | 'flow' | 'reward'; title: string; color: string; items: PaletteItem[] }[]`, `PaletteItem = { id: StepKind | TriggerType; label: string; icon: string; trigger?: true }`, `disabledReason(item, steps, triggerType, limits): string | null`
  - `<Palette onPick(item) onDragStartItem?/>` (also `compact` mode for the `+` popover)
  - `<FlowCanvas graph positions triggerType triggerLabel selectedId issuesByStep onSelect(id) onMove(id, pos) onInsert(kind, anchor) onAddLoose(kind, pos) onConnect(from, to) onDisconnect(from) onRemove(id) onPickTrigger(type) limits/>`
  - drag data type `'application/x-flow-item'` = palette item id.

- [ ] **Step 1: Failing spec for palette rules**

```ts
// app/pages/marketing-workflow/palette.spec.ts
import { describe, expect, it } from 'vitest';
import { disabledReason, PALETTE } from './palette';
import { newStep } from './workflow-graph';

const limits = { maxWaitSteps: 3, maxConditionSteps: 5, maxAudienceSteps: 1, maxWaitMinutes: 43200, maxHeaders: 20, maxBodyBytes: 16384, minSplitBranches: 2, maxSplitBranches: 4 };
const item = (id: string) => PALETTE.flatMap((c) => c.items).find((i) => i.id === id)!;

describe('palette', () => {
  it('lists only phase-1 items', () => {
    expect(PALETTE.flatMap((c) => c.items).map((i) => i.id)).toEqual([
      'scheduled', 'order_milestone', 'first_login', 'app_login', 'push', 'email', 'in_app', 'webhook', 'wait', 'condition', 'split', 'audience', 'grant_coupon']);
  });
  it('greys out items at their limit', () => {
    expect(disabledReason(item('audience'), [newStep('audience')], 'first_login', limits)).not.toBeNull();
    expect(disabledReason(item('wait'), [newStep('wait'), newStep('wait'), newStep('wait')], 'first_login', limits)).not.toBeNull();
    expect(disabledReason(item('wait'), [], 'first_login', limits)).toBeNull();
    expect(disabledReason(item('first_login'), [], 'first_login', limits)).not.toBeNull(); // already the trigger
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run apps/commerce-admin/src/app/pages/marketing-workflow/palette.spec.ts --config apps/commerce-admin/vite.config.mts`

- [ ] **Step 3: Implement `palette.ts`**

```ts
// app/pages/marketing-workflow/palette.ts
import { uiText } from '@cp/ui';
import type { TriggerType, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import type { StepKind } from './workflow-graph';

export interface PaletteItem { id: StepKind | TriggerType; get label(): string; icon: string; trigger?: true }
export interface PaletteCategory { category: 'entry' | 'channel' | 'flow' | 'reward'; get title(): string; color: string; items: PaletteItem[] }

/** Category colours from the reference journey builder (entry green, channels purple, flow blue, integrations orange). */
export const PALETTE: PaletteCategory[] = [
  { category: 'entry', get title() { return uiText('ENTRY'); }, color: '#5b9a2f', items: [
    { id: 'scheduled', get label() { return uiText('ตามเวลา (Scheduled)'); }, icon: 'schedule', trigger: true },
    { id: 'order_milestone', get label() { return uiText('ยอดสั่งซื้อถึงเป้า'); }, icon: 'shopping_cart', trigger: true },
    { id: 'first_login', get label() { return uiText('เข้าแอปครั้งแรก'); }, icon: 'login', trigger: true },
    { id: 'app_login', get label() { return uiText('กลับมาเข้าแอป'); }, icon: 'replay', trigger: true },
  ] },
  { category: 'channel', get title() { return uiText('CHANNELS'); }, color: '#a157d8', items: [
    { id: 'push', get label() { return uiText('Push'); }, icon: 'notifications' },
    { id: 'email', get label() { return uiText('Email'); }, icon: 'mail' },
    { id: 'in_app', get label() { return uiText('In-App'); }, icon: 'chat' },
    { id: 'webhook', get label() { return uiText('Webhook'); }, icon: 'webhook' },
  ] },
  { category: 'flow', get title() { return uiText('FLOW'); }, color: '#3d8fe8', items: [
    { id: 'wait', get label() { return uiText('Time Delay'); }, icon: 'schedule' },
    { id: 'condition', get label() { return uiText('Condition Split'); }, icon: 'call_split' },
    { id: 'split', get label() { return uiText('A/B Split'); }, icon: 'alt_route' },
    { id: 'audience', get label() { return uiText('Audience filter'); }, icon: 'group' },
  ] },
  { category: 'reward', get title() { return uiText('REWARDS'); }, color: '#e5853a', items: [
    { id: 'grant_coupon', get label() { return uiText('แจกคูปอง'); }, icon: 'local_offer' },
  ] },
];

export const categoryOf = (id: string) => PALETTE.find((c) => c.items.some((i) => i.id === id))!;

/** Kind of a saved step, for colours / icons on the canvas. */
export function kindOf(step: WorkflowStep): StepKind {
  if (step.type === 'action') return step.action.kind === 'grant_coupon' ? 'grant_coupon' : step.action.channels[0] ?? 'push';
  return step.type as StepKind;
}

export function disabledReason(item: PaletteItem, steps: WorkflowStep[], triggerType: TriggerType, limits: WorkflowMeta['limits']): string | null {
  if (item.trigger) return item.id === triggerType ? uiText('ใช้อยู่แล้ว') : null;
  const count = (t: WorkflowStep['type']) => steps.filter((s) => s.type === t).length;
  if (item.id === 'audience' && count('audience') >= limits.maxAudienceSteps) return uiText('มี Audience filter ได้ 1 อัน');
  if (item.id === 'wait' && count('wait') >= limits.maxWaitSteps) return uiText('Time Delay ครบ {0} อันแล้ว', { 0: limits.maxWaitSteps });
  if (item.id === 'condition' && count('condition') >= limits.maxConditionSteps) return uiText('Condition ครบ {0} อันแล้ว', { 0: limits.maxConditionSteps });
  return null;
}
```
Check `libs/ui/src/icons.ts` for the icon names used above (`schedule`, `shopping_cart`, `login`, `replay`, `notifications`, `mail`, `chat`, `webhook`, `call_split`, `alt_route`, `group`, `local_offer`); swap any missing name for the nearest one that exists there (the map is string → react-icons/md component). Check `uiText`'s placeholder argument shape against an existing call (`uiText("…", { "0": x })`).

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run apps/commerce-admin/src/app/pages/marketing-workflow/palette.spec.ts --config apps/commerce-admin/vite.config.mts`

- [ ] **Step 5: `Palette.tsx`**

```tsx
// app/pages/marketing-workflow/Palette.tsx
import { useState } from 'react';
import { Icon, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { TriggerType, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { disabledReason, PALETTE, type PaletteItem } from './palette';

export const DRAG_TYPE = 'application/x-flow-item';

/** Left toolbar: searchable, collapsible categories; drag an item onto the canvas, or click / Enter to append. */
export function Palette({ steps, triggerType, limits, onPick, compact = false }: {
  steps: WorkflowStep[]; triggerType: TriggerType; limits: WorkflowMeta['limits']; onPick: (item: PaletteItem) => void; compact?: boolean;
}) {
  __useUiLocale();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  return (
    <div className={compact ? 'w-64' : 'flex h-full w-60 shrink-0 flex-col overflow-y-auto rounded-xl border border-outline-variant bg-surface p-3'}>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={__uiText('ค้นหา')} aria-label={__uiText('ค้นหา step')}
        className="mb-3 w-full rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-sm" />
      {PALETTE.filter((c) => !compact || c.category !== 'entry').map((cat) => {
        const items = cat.items.filter((i) => !q || i.label.toLowerCase().includes(q));
        if (!items.length) return null;
        const open = !closed[cat.category] || !!q;
        return (
          <section key={cat.category} className="mb-3">
            <button type="button" className="flex w-full items-center justify-between py-1 text-xs font-semibold tracking-wide text-on-surface-variant"
              aria-expanded={open} onClick={() => setClosed((c) => ({ ...c, [cat.category]: open }))}>
              {cat.title}<Icon name={open ? 'expand_less' : 'expand_more'} />
            </button>
            {open && items.map((item) => {
              const reason = disabledReason(item, steps, triggerType, limits);
              return (
                <button key={item.id} type="button" disabled={!!reason} title={reason ?? undefined}
                  draggable={!reason && !item.trigger} onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => onPick(item)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white" style={{ background: cat.color }}><Icon name={item.icon} /></span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
```
Check `Icon`'s props (`name`) and that `expand_less` / `expand_more` exist in `icons.ts`; check the theme token class names (`border-outline-variant`, `bg-surface`, `bg-surface-container`, `text-on-surface-variant`) exist in `libs/ui/theme.css` — replace any that don't with ones that do.

- [ ] **Step 6: `NodeCard.tsx`**

```tsx
// app/pages/marketing-workflow/NodeCard.tsx
import { memo, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Icon, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';

export interface FlowNodeData extends Record<string, unknown> {
  title: string; subtitle: string; color: string; icon: string; isTrigger: boolean; issue?: string;
  ports: { port?: string; label: string; free: boolean }[];
  onPlus: (port: string | undefined, rect: DOMRect) => void; onRemove?: () => void;
}
export type FlowNode = Node<FlowNodeData, 'flowStep'>;

/** ~240×72 card: coloured icon square, title, one-line summary; in-handle left, one out-handle (+ button) per port on the right. */
function FlowStepNode({ data, selected }: NodeProps<FlowNode>) {
  __useUiLocale();
  const [hover, setHover] = useState(false);
  const many = data.ports.length > 1;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={`relative flex w-60 items-center gap-3 rounded-xl border bg-surface px-3 py-3 shadow-sm ${selected ? 'border-primary ring-2 ring-primary/20' : data.issue ? 'border-error' : 'border-outline-variant'}`}
      title={data.issue}>
      {!data.isTrigger && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-outline" />}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: data.color }}><Icon name={data.icon} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-on-surface">{data.title}</div>
        <div className="truncate text-xs text-on-surface-variant">{data.subtitle}</div>
      </div>
      {data.onRemove && hover && (
        <button type="button" className="absolute -right-2 -top-2 rounded-full bg-surface p-0.5 text-on-surface-variant shadow hover:text-error"
          title={__uiText('ลบขั้นตอนนี้')} aria-label={__uiText('ลบขั้นตอนนี้')} onClick={(e) => { e.stopPropagation(); data.onRemove!(); }}>
          <Icon name="close" />
        </button>
      )}
      {data.ports.map((p, i) => {
        const top = many ? `${((i + 1) / (data.ports.length + 1)) * 100}%` : '50%';
        return (
          <div key={p.port ?? 'out'}>
            <Handle id={p.port} type="source" position={Position.Right} style={{ top }} className="!h-3 !w-3 !border-2 !border-white !bg-primary" />
            {many && <span className="pointer-events-none absolute left-full ml-5 -translate-y-1/2 whitespace-nowrap text-[10px] text-on-surface-variant" style={{ top }}>{p.label}</span>}
            {p.free && (
              <button type="button" aria-label={__uiText('เพิ่ม step ต่อจากตรงนี้')} style={{ top }}
                className="nodrag absolute left-full ml-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded border border-outline-variant bg-surface text-xs text-on-surface-variant hover:border-primary hover:text-primary"
                onClick={(e) => { e.stopPropagation(); data.onPlus(p.port, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}>+</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const flowNodeTypes = { flowStep: memo(FlowStepNode) };
```
When a port has a label (condition / split) the label sits right of the handle; the `+` button sits at the same height. If they overlap visually in Step 9's browser check, move the label above the handle (`-translate-y-[120%]`).

- [ ] **Step 7: `FlowCanvas.tsx`**

```tsx
// app/pages/marketing-workflow/FlowCanvas.tsx
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, ReactFlow, ReactFlowProvider, useEdgesState, useNodesInitialized,
  useNodesState, useReactFlow, useStoreApi, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react';
import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { CanvasPosition, TriggerType, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { flowNodeTypes, type FlowNode } from './NodeCard';
import { categoryOf, kindOf, PALETTE, type PaletteItem } from './palette';
import { DRAG_TYPE, Palette } from './Palette';
import { autoLayout, outPorts, TRIGGER, type Anchor, type Graph, type StepKind } from './workflow-graph';

export interface FlowCanvasProps {
  graph: Graph; positions: Record<string, CanvasPosition>; triggerType: TriggerType; triggerTitle: string; triggerSubtitle: string;
  selectedId: string | null; issuesByStep: Record<string, string>; limits: WorkflowMeta['limits'];
  describe: (step: WorkflowStep) => { title: string; subtitle: string };
  onSelect: (id: string | null) => void; onMove: (id: string, pos: CanvasPosition) => void;
  onInsert: (kind: StepKind, anchor: Anchor) => void; onAddLoose: (kind: StepKind, pos: CanvasPosition) => void;
  onConnect: (from: Anchor, to: string) => void; onDisconnect: (from: Anchor) => void; onRemove: (id: string) => void;
  onPickTrigger: (type: TriggerType) => void;
}

/** Same workaround as the josh canvas: nodes loaded in a hidden tab never measure → force it, then fit. */
function MeasurementWatchdog() {
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const storeApi = useStoreApi();
  const [attempt, setAttempt] = useState(0);
  const kicked = useRef(false);
  useEffect(() => {
    if (nodesInitialized) { if (kicked.current) { kicked.current = false; fitView({ padding: 0.3, maxZoom: 1 }); } return; }
    if (attempt >= 10) return;
    const timer = setTimeout(() => {
      const { domNode, updateNodeInternals } = storeApi.getState();
      const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>();
      domNode?.querySelectorAll<HTMLDivElement>('.react-flow__node[data-id]').forEach((el) => {
        const id = el.getAttribute('data-id'); if (id) updates.set(id, { id, nodeElement: el, force: true });
      });
      if (updates.size > 0) { kicked.current = true; updateNodeInternals(updates); }
      setAttempt((a) => a + 1);
    }, 100);
    return () => clearTimeout(timer);
  }, [nodesInitialized, attempt, fitView, storeApi]);
  return null;
}

function Canvas(p: FlowCanvasProps) {
  __useUiLocale();
  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow();
  const [plus, setPlus] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);
  const layout = useMemo(() => ({ ...autoLayout(p.graph), ...p.positions }), [p.graph, p.positions]);

  const computedNodes: FlowNode[] = useMemo(() => {
    const entry = PALETTE[0];
    const triggerNode: FlowNode = { id: TRIGGER, type: 'flowStep', position: layout[TRIGGER] ?? { x: 0, y: 0 }, draggable: false, deletable: false,
      selected: p.selectedId === TRIGGER, data: { title: p.triggerTitle, subtitle: p.triggerSubtitle, color: entry.color,
        icon: entry.items.find((i) => i.id === p.triggerType)?.icon ?? 'bolt', isTrigger: true, issue: p.issuesByStep[TRIGGER],
        ports: [{ label: '', free: !p.graph.entryStepId }], onPlus: (_port, r) => setPlus({ anchor: { stepId: TRIGGER }, x: r.right, y: r.top }) } };
    return [triggerNode, ...p.graph.steps.map((s): FlowNode => {
      const kind = kindOf(s); const cat = categoryOf(kind); const d = p.describe(s);
      return { id: s.id, type: 'flowStep', position: layout[s.id] ?? { x: 0, y: 0 }, selected: p.selectedId === s.id,
        data: { title: d.title, subtitle: d.subtitle, color: cat.color, icon: cat.items.find((i) => i.id === kind)?.icon ?? 'circle', isTrigger: false,
          issue: p.issuesByStep[s.id], ports: outPorts(s).map((o) => ({ port: o.port, label: o.label, free: o.target === null })),
          onPlus: (port, r) => setPlus({ anchor: { stepId: s.id, port }, x: r.right, y: r.top }), onRemove: () => p.onRemove(s.id) } };
    })];
  }, [p, layout]);

  const computedEdges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    const add = (source: string, port: string | undefined, target: string | null, label?: string) => {
      if (target) out.push({ id: `${source}:${port ?? ''}->${target}`, source, sourceHandle: port, target, type: 'smoothstep', label,
        markerEnd: { type: MarkerType.ArrowClosed }, data: { port } });
    };
    add(TRIGGER, undefined, p.graph.entryStepId);
    for (const s of p.graph.steps) for (const o of outPorts(s)) add(s.id, o.port, o.target, s.type === 'action' || s.type === 'webhook' || s.type === 'audience' || s.type === 'wait' ? undefined : o.label);
    return out;
  }, [p.graph]);

  // xyflow keeps measured sizes, drag positions and selection on its own node state (as the josh canvas does);
  // the editor's graph is the source of truth and is pushed in on every change, keeping `measured`.
  const [nodes, setNodes, applyNodeChanges] = useNodesState<FlowNode>([]);
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<Edge>([]);
  useEffect(() => {
    setNodes((prev) => computedNodes.map((n) => ({ ...n, measured: prev.find((x) => x.id === n.id)?.measured })));
  }, [computedNodes, setNodes]);
  useEffect(() => { setEdges(computedEdges); }, [computedEdges, setEdges]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    applyNodeChanges(changes.filter((c) => c.type !== 'remove'));
    for (const c of changes) {
      if (c.type === 'remove' && c.id !== TRIGGER) p.onRemove(c.id);
      if (c.type === 'select' && c.selected) p.onSelect(c.id);
    }
  }, [applyNodeChanges, p]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    applyEdgeChanges(changes.filter((c) => c.type !== 'remove'));
    for (const c of changes) if (c.type === 'remove') {
      const e = edges.find((x) => x.id === c.id);
      if (e) p.onDisconnect({ stepId: e.source, port: (e.data as { port?: string } | undefined)?.port });
    }
  }, [applyEdgeChanges, edges, p]);
  const onConnect = useCallback((c: Connection) => { if (c.source && c.target) p.onConnect({ stepId: c.source, port: c.sourceHandle ?? undefined }, c.target); }, [p]);
  const isValidConnection = useCallback((c: Connection | Edge) => !c.target || (c.source !== c.target && c.target !== TRIGGER), []);

  const onDrop = useCallback((e: React.DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_TYPE) as StepKind;
    if (!kind) return;
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const hit = getIntersectingNodes({ x: pos.x, y: pos.y, width: 1, height: 1 })[0];
    if (!hit) return p.onAddLoose(kind, pos);
    if (hit.id === TRIGGER) return p.onInsert(kind, { stepId: TRIGGER });
    const step = p.graph.steps.find((s) => s.id === hit.id);
    const ports = step ? outPorts(step) : [];
    const free = ports.find((o) => o.target === null);
    if (ports.length <= 1) return p.onInsert(kind, { stepId: hit.id, port: ports[0]?.port });
    if (free) return p.onInsert(kind, { stepId: hit.id, port: free.port });
    const r = (e.target as HTMLElement).getBoundingClientRect();
    setPlus({ anchor: { stepId: hit.id, port: ports[0].port }, x: r.right, y: r.top }); // all ports taken: let staff pick via the popover
  }, [getIntersectingNodes, p, screenToFlowPosition]);

  const pick = (item: PaletteItem) => { if (plus && !item.trigger) p.onInsert(item.id as StepKind, plus.anchor); setPlus(null); };

  return (
    <div className="relative h-full w-full rounded-xl border border-outline-variant bg-surface-container-low" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={flowNodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} isValidConnection={isValidConnection} onNodeDragStop={((_: unknown, n: FlowNode) => n.id !== TRIGGER && p.onMove(n.id, n.position)) as never}
        onPaneClick={() => { p.onSelect(null); setPlus(null); }} connectionMode={ConnectionMode.Loose} connectionRadius={48}
        deleteKeyCode={['Backspace', 'Delete']} fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{ 'controls.ariaLabel': __uiText('Workflow controls'), 'controls.zoomIn.ariaLabel': __uiText('Zoom in'),
          'controls.zoomOut.ariaLabel': __uiText('Zoom out'), 'controls.fitView.ariaLabel': __uiText('Fit view'), 'controls.interactive.ariaLabel': __uiText('Toggle interactivity') }}>
        <MeasurementWatchdog />
        <Background variant={BackgroundVariant.Lines} gap={24} color="#e3e7ee" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {!p.graph.steps.length && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-on-surface-variant">
          {__uiText('ลาก step จากแถบซ้ายมาวาง — Entry → Message หรือ Action → +')}
        </div>
      )}
      {plus && (
        <div className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-outline-variant bg-surface p-2 shadow-lg" style={{ left: plus.x + 8, top: plus.y }}>
          <Palette compact steps={p.graph.steps} triggerType={p.triggerType} limits={p.limits} onPick={pick} />
        </div>
      )}
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
```
The `ariaLabelConfig` keys are copied from the josh canvas (they compiled there on 12.12). `getIntersectingNodes` accepts a rect in flow coordinates in 12.x; if TypeScript rejects the object, pass `{ id: 'drop', position: pos, width: 1, height: 1 } as never` the way the 12.x docs show for a node-like argument.

- [ ] **Step 8: Typecheck**

Run: `npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit`
Expected: no errors in the new files.

- [ ] **Step 9: Commit**

```bash
git add apps/commerce-admin/src/app/pages/marketing-workflow
git commit -m "feat(admin): flow palette (search, categories, limits), node cards with + per port, canvas with drag-drop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: commerce-admin — side panel forms

**Files:**
- Modify (add `export` only): `app/pages/workflow-editor/josh/TriggerRuleBuilder.tsx` (`ScheduledTriggerFields` ~L456, `OrderMilestoneFields` ~L363), `MarketingStepSidePanel.tsx` (`CouponPicker` ~L291, `NotifyTemplatePicker` ~L428), `MarketingWorkflowEditor.tsx` (`ScheduleEditor` ~L165, `defaultSchedule` ~L145)
- Create: `app/pages/marketing-workflow/forms/TriggerForm.tsx`, `forms/StepForms.tsx`, `forms/WebhookForm.tsx`, `forms/SplitForm.tsx`, `StepPanel.tsx`

**Interfaces:**
- Consumes: `flowsApi` (Task 9); josh exports above; `getCoupons` from `workflow-editor/josh/extra.api.ts` (rows at `response?.data?.data?.data`, map `{ id, coupon_code, title }`).
- Produces: `<StepPanel selection={TRIGGER | stepId | null} workflow={WorkflowInput & { status }} meta segments coupons secrets onChangeInput(patch: Partial<WorkflowInput>) onChangeStep(step) onRemoveStep(id) onSecretsChanged()/>`; `describeStep(step, ctx) → { title, subtitle }` (used by the canvas), `describeTrigger(type, config) → { title, subtitle }`.

- [ ] **Step 1: Export the five josh components** — prefix each listed `function` with `export` (`export function ScheduledTriggerFields(`, etc.). Run `npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit` — the existing editor still compiles.

- [ ] **Step 2: `TriggerForm.tsx`**

```tsx
// app/pages/marketing-workflow/forms/TriggerForm.tsx
import '../../workflow-editor/josh/josh-tailwind.css';
import { Checkbox, Field, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { TriggerType, WorkflowInput } from '@cp/marketing-workflow';
import { OrderMilestoneFields, ScheduledTriggerFields } from '../../workflow-editor/josh/TriggerRuleBuilder';
import { defaultSchedule, ScheduleEditor } from '../../workflow-editor/josh/MarketingWorkflowEditor';
import { PALETTE } from '../palette';

export const TRIGGER_DEFAULTS: Record<TriggerType, WorkflowInput['triggerConfig']> = {
  scheduled: { time: '18:00', daysOfWeek: [], timezone: 'Asia/Bangkok' },
  order_milestone: { metric: 'single_order_total', operator: '>=', value: 5000 },
  first_login: {}, app_login: {},
};

export function describeTrigger(type: TriggerType, config: WorkflowInput['triggerConfig']): { title: string; subtitle: string } {
  const title = PALETTE[0].items.find((i) => i.id === type)?.label ?? type;
  const c = config as Record<string, unknown>;
  if (type === 'scheduled') return { title, subtitle: __uiText('ทุกวัน {0}', { 0: String(c.time ?? '') }) };
  if (type === 'order_milestone') return { title, subtitle: `${String(c.metric)} ${String(c.operator)} ${String(c.value)}` };
  return { title, subtitle: __uiText('นับเฉพาะหลังกด Activate') };
}

/** Entry card: trigger type + its config, schedule window, cooldown / holdout / conversion / exit goal. */
export function TriggerForm({ input, onChange }: { input: WorkflowInput; onChange: (patch: Partial<WorkflowInput>) => void }) {
  __useUiLocale();
  const num = (v: string) => (v === '' ? 0 : Math.trunc(Number(v)));
  return (
    <div className="space-y-4">
      <Field label={__uiText('เริ่มเมื่อ')}>
        <Select value={input.triggerType} onChange={(e) => { const t = e.target.value as TriggerType; onChange({ triggerType: t, triggerConfig: TRIGGER_DEFAULTS[t] }); }}>
          {PALETTE[0].items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </Select>
      </Field>
      <div className="josh-tw">
        {input.triggerType === 'scheduled' && <ScheduledTriggerFields config={input.triggerConfig as never} onUpdateTrigger={(c) => onChange({ triggerConfig: c as never })} />}
        {input.triggerType === 'order_milestone' && <OrderMilestoneFields config={input.triggerConfig as never} onUpdateTrigger={(c) => onChange({ triggerConfig: c as never })} />}
      </div>
      <Field label={__uiText('ช่วงเวลาทำงาน')}>
        <div className="josh-tw"><ScheduleEditor schedule={(input.schedule ?? null) as never} onChange={(s) => onChange({ schedule: s as never })} /></div>
        {!input.schedule && <button type="button" className="text-xs text-primary" onClick={() => onChange({ schedule: defaultSchedule() as never })}>{__uiText('จำกัดช่วงเวลา')}</button>}
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label={__uiText('Cooldown (วัน)')}><Input type="number" min={0} max={365} value={input.cooldownDays} onChange={(e) => onChange({ cooldownDays: num(e.target.value) })} /></Field>
        <Field label={__uiText('Holdout %')}><Input type="number" min={0} max={50} value={input.holdoutPercent} onChange={(e) => onChange({ holdoutPercent: num(e.target.value) })} /></Field>
        <Field label={__uiText('วัด conversion (วัน)')}><Input type="number" min={1} max={90} value={input.conversionWindowDays} onChange={(e) => onChange({ conversionWindowDays: num(e.target.value) })} /></Field>
      </div>
      <Checkbox checked={input.exitOnGoal?.kind === 'order_placed'} onChange={(e) => onChange({ exitOnGoal: e.target.checked ? { kind: 'order_placed' } : null })}
        label={__uiText('หยุดส่งเมื่อลูกค้าสั่งซื้อแล้ว')} />
    </div>
  );
}
```
`ScheduleEditor` shows a "ตลอดเวลา" toggle itself when `schedule` is null (see its docblock); if it does, drop the extra "จำกัดช่วงเวลา" button. Check `Field`, `Select`, `Checkbox` prop names in `libs/ui/src/index.tsx` and adapt (e.g. `Checkbox` may take `label` as children).

- [ ] **Step 3: `StepForms.tsx` (audience, wait, condition, notify, coupon) + `describeStep`**

```tsx
// app/pages/marketing-workflow/forms/StepForms.tsx
import '../../workflow-editor/josh/josh-tailwind.css';
import { useState } from 'react';
import { Button, Checkbox, Field, Hint, Input, Textarea, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { NotifyChannel, SegmentOption, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { flowsApi } from '../../../../lib/api';
import { CouponPicker, NotifyTemplatePicker } from '../../workflow-editor/josh/MarketingStepSidePanel';
import { PALETTE } from '../palette';

type Of<T extends WorkflowStep['type']> = Extract<WorkflowStep, { type: T }>;
export interface CouponOption { id: string; coupon_code: string; title: string }
const CHANNELS: { id: NotifyChannel; label: string }[] = [{ id: 'push', label: 'Push' }, { id: 'email', label: 'Email' }, { id: 'in_app', label: 'In-App' }];

export function describeStep(step: WorkflowStep, ctx: { segments: SegmentOption[]; coupons: CouponOption[] }): { title: string; subtitle: string } {
  const label = (id: string) => PALETTE.flatMap((c) => c.items).find((i) => i.id === id)?.label ?? id;
  switch (step.type) {
    case 'audience': return { title: label('audience'), subtitle: (step.segmentIds ?? []).map((id) => ctx.segments.find((s) => s.id === id)?.name ?? id).join(', ') || __uiText('ทุกคน') };
    case 'wait': return { title: label('wait'), subtitle: __uiText('{0} ชม. {1} นาที', { 0: step.hours, 1: step.minutes ?? 0 }) };
    case 'condition': return { title: label('condition'), subtitle: step.expression };
    case 'split': return { title: label('split'), subtitle: step.branches.map((b) => `${b.label} ${b.percent}%`).join(' / ') };
    case 'webhook': return { title: label('webhook'), subtitle: `${step.method} ${step.url || '—'}` };
    case 'action': return step.action.kind === 'notify'
      ? { title: step.action.channels.map((c) => label(c)).join(' + '), subtitle: step.action.templateKey || __uiText('ยังไม่เลือก template') }
      : { title: label('grant_coupon'), subtitle: ctx.coupons.find((c) => c.id === (step.action as { couponId: string }).couponId)?.coupon_code ?? __uiText('ยังไม่เลือกคูปอง') };
  }
}

export function AudienceForm({ step, segments, onChange }: { step: Of<'audience'>; segments: SegmentOption[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const toggle = (key: 'segmentIds' | 'excludeSegmentIds', id: string) => {
    const cur = step[key] ?? [];
    onChange({ ...step, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <div className="space-y-4">
      {(['segmentIds', 'excludeSegmentIds'] as const).map((key) => (
        <Field key={key} label={key === 'segmentIds' ? __uiText('อยู่ใน segment ใดก็ได้') : __uiText('ยกเว้น segment')}>
          {!segments.length && <Hint>{__uiText('ยังไม่มี segment ที่ใช้กับ workflow ของ commerce ได้')}</Hint>}
          {segments.map((s) => (
            <Checkbox key={s.id} checked={(step[key] ?? []).includes(s.id)} onChange={() => toggle(key, s.id)}
              label={`${s.name}${s.memberCount != null ? ` (${s.memberCount})` : ''}`} />
          ))}
        </Field>
      ))}
    </div>
  );
}

export function WaitForm({ step, maxMinutes, onChange }: { step: Of<'wait'>; maxMinutes: number; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const total = step.hours * 60 + (step.minutes ?? 0);
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={__uiText('ชั่วโมง')}><Input type="number" min={0} value={step.hours} onChange={(e) => onChange({ ...step, hours: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></Field>
      <Field label={__uiText('นาที')}><Input type="number" min={0} max={59} value={step.minutes ?? 0} onChange={(e) => onChange({ ...step, minutes: Math.min(59, Math.max(0, Math.trunc(Number(e.target.value) || 0))) })} /></Field>
      {(total < 1 || total > maxMinutes) && <Hint>{__uiText('รอได้ 1 นาที ถึง 30 วัน')}</Hint>}
    </div>
  );
}

export function ConditionForm({ step, meta, onChange }: { step: Of<'condition'>; meta: WorkflowMeta; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
  return (
    <div className="space-y-3">
      <Field label={__uiText('เงื่อนไข')}>
        <Textarea rows={3} value={step.expression} onChange={(e) => { setCheck(null); onChange({ ...step, expression: e.target.value }); }} className="font-mono text-xs" />
      </Field>
      <div className="flex flex-wrap gap-1">
        {meta.expressionFields.map((f) => (
          <button key={f.field} type="button" title={f.label} className="rounded border border-outline-variant px-2 py-0.5 font-mono text-xs"
            onClick={() => onChange({ ...step, expression: `${step.expression}${step.expression ? ' AND ' : ''}${f.field} ${f.type === 'number' ? '>= 1' : f.type === 'segment' ? '== "<segment-id>"' : '== true'}` })}>
            {f.field}
          </button>
        ))}
      </div>
      <Hint>{__uiText('ตัวอย่าง: still_no_order == true AND user.order_count >= 2 · ไป Yes เมื่อจริง, No เมื่อเท็จ')}</Hint>
      <Button size="sm" onClick={async () => setCheck(await flowsApi.validateExpression(step.expression))}>{__uiText('ตรวจเงื่อนไข')}</Button>
      {check && <Hint>{check.ok ? __uiText('ใช้ได้') : check.error}</Hint>}
    </div>
  );
}

export function NotifyForm({ step, onChange }: { step: Of<'action'>; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  if (step.action.kind !== 'notify') return null;
  const a = step.action;
  const toggle = (c: NotifyChannel) => onChange({ ...step, action: { ...a, channels: a.channels.includes(c) ? a.channels.filter((x) => x !== c) : [...a.channels, c] } });
  return (
    <div className="space-y-3">
      <Field label={__uiText('ช่องทาง')}>{CHANNELS.map((c) => <Checkbox key={c.id} checked={a.channels.includes(c.id)} onChange={() => toggle(c.id)} label={c.label} />)}</Field>
      <Field label={__uiText('Template ข้อความ (josh)')}>
        <div className="josh-tw"><NotifyTemplatePicker templateKey={a.templateKey} onSelect={(key) => onChange({ ...step, action: { ...a, templateKey: key } })} /></div>
      </Field>
      <Hint>{__uiText('josh เป็นคนส่งจริง และเคารพการปิดรับข่าวสารของลูกค้า')}</Hint>
    </div>
  );
}

export function CouponForm({ step, coupons, onChange }: { step: Of<'action'>; coupons: CouponOption[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  if (step.action.kind !== 'grant_coupon') return null;
  return (
    <Field label={__uiText('คูปอง')}>
      <div className="josh-tw"><CouponPicker coupons={coupons} value={step.action.couponId || undefined} onChange={(couponId) => onChange({ ...step, action: { kind: 'grant_coupon', couponId } })} /></div>
    </Field>
  );
}
```

- [ ] **Step 4: `SplitForm.tsx`**

```tsx
// app/pages/marketing-workflow/forms/SplitForm.tsx
import { Button, Field, Hint, Input, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';

type Split = Extract<WorkflowStep, { type: 'split' }>;
const LETTERS = 'ABCD';

export function SplitForm({ step, limits, onChange }: { step: Split; limits: WorkflowMeta['limits']; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const sum = step.branches.reduce((a, b) => a + (b.percent || 0), 0);
  const set = (i: number, patch: Partial<Split['branches'][number]>) => onChange({ ...step, branches: step.branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const even = () => {
    const n = step.branches.length; const base = Math.floor(100 / n);
    onChange({ ...step, branches: step.branches.map((b, i) => ({ ...b, percent: base + (i < 100 - base * n ? 1 : 0) })) });
  };
  return (
    <div className="space-y-3">
      {step.branches.map((b, i) => (
        <div key={b.id} className="flex items-end gap-2">
          <Field label={__uiText('ชื่อกิ่ง')}><Input value={b.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} /></Field>
          <Field label="%"><Input type="number" min={1} max={99} value={b.percent} onChange={(e) => set(i, { percent: Math.trunc(Number(e.target.value) || 0) })} /></Field>
          {step.branches.length > limits.minSplitBranches && (
            <Button size="sm" variant="ghost" icon="delete" aria-label={__uiText('ลบกิ่ง')} onClick={() => onChange({ ...step, branches: step.branches.filter((_, j) => j !== i) })} />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {step.branches.length < limits.maxSplitBranches && (
          <Button size="sm" icon="add" onClick={() => onChange({ ...step, branches: [...step.branches, { id: crypto.randomUUID(), label: LETTERS[step.branches.length] ?? 'X', percent: 0, nextId: null }] })}>
            {__uiText('เพิ่มกิ่ง')}
          </Button>
        )}
        <Button size="sm" onClick={even}>{__uiText('แบ่งเท่ากัน')}</Button>
      </div>
      {sum !== 100 && <Hint>{__uiText('สัดส่วนรวมตอนนี้ {0}% — ต้องเท่ากับ 100%', { 0: sum })}</Hint>}
      <Hint>{__uiText('ลูกค้าคนเดิมได้กิ่งเดิมเสมอ · ดูผลแต่ละกิ่งได้ที่แท็บผลลัพธ์')}</Hint>
    </div>
  );
}
```

- [ ] **Step 5: `WebhookForm.tsx`**

```tsx
// app/pages/marketing-workflow/forms/WebhookForm.tsx
import { useState } from 'react';
import { Button, Checkbox, Field, Hint, Input, Select, Textarea, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { WebhookSecretItem, WebhookTestResult, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { flowsApi } from '../../../../lib/api';

type Webhook = Extract<WorkflowStep, { type: 'webhook' }>;
const SECRET_REF = /^\{\{secret:([0-9a-f-]{36})\}\}$/i;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

/** Webhook step: method, URL, headers (a row can be a stored secret), body template, test send. */
export function WebhookForm({ step, meta, secrets, onChange, onSecretsChanged }: {
  step: Webhook; meta: WorkflowMeta; secrets: WebhookSecretItem[]; onChange: (s: WorkflowStep) => void; onSecretsChanged: () => void;
}) {
  __useUiLocale();
  const [draftSecret, setDraftSecret] = useState<Record<number, string>>({});
  const [result, setResult] = useState<WebhookTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setHeader = (i: number, patch: Partial<Webhook['headers'][number]>) => onChange({ ...step, headers: step.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  let host = '';
  try { host = new URL(step.url).hostname; } catch { /* not a URL yet */ }
  const warnUrl = step.url && !step.url.includes('{{') && (!/^https?:\/\//i.test(step.url) || PRIVATE_HOST.test(host));

  const saveSecret = async (i: number) => {
    const value = draftSecret[i]; if (!value) return;
    setBusy(true); setError(null);
    try {
      const ref = SECRET_REF.exec(step.headers[i].value)?.[1];
      const item = ref ? await flowsApi.secrets.replace(ref, value) : await flowsApi.secrets.create(`${step.headers[i].key || 'header'} · ${host || 'webhook'}`, value);
      setHeader(i, { value: `{{secret:${item.id}}}` });
      setDraftSecret((d) => ({ ...d, [i]: '' }));
      onSecretsChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={step.method} onChange={(e) => onChange({ ...step, method: e.target.value as Webhook['method'], ...(e.target.value === 'GET' ? { body: '' } : {}) })}>
          {['POST', 'PUT', 'PATCH', 'GET'].map((m) => <option key={m}>{m}</option>)}
        </Select>
        <Input className="flex-1" placeholder="https://" value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} aria-label="URL" />
      </div>
      {warnUrl && <Hint>{__uiText('URL ต้องขึ้นต้นด้วย https:// และชี้ไปที่ระบบภายนอก (ระบบไม่ยิงเข้าเครือข่ายภายใน)')}</Hint>}

      <Field label={__uiText('Headers')}>
        {step.headers.map((h, i) => {
          const ref = SECRET_REF.exec(h.value)?.[1];
          const isSecret = !!ref || draftSecret[i] !== undefined;
          const name = ref ? secrets.find((s) => s.id === ref)?.name ?? __uiText('ค่าลับถูกลบแล้ว') : '';
          return (
            <div key={i} className="mb-2 space-y-1 rounded-lg border border-outline-variant p-2">
              <div className="flex gap-2">
                <Input placeholder="Header" value={h.key} onChange={(e) => setHeader(i, { key: e.target.value })} />
                {isSecret
                  ? <Input type="password" autoComplete="off" placeholder={ref ? `•••• (${name})` : __uiText('ใส่ค่าลับ')} value={draftSecret[i] ?? ''}
                      onChange={(e) => setDraftSecret((d) => ({ ...d, [i]: e.target.value }))} />
                  : <Input placeholder={__uiText('ค่า')} value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} />}
                <Button size="sm" variant="ghost" icon="delete" aria-label={__uiText('ลบ header')} onClick={() => onChange({ ...step, headers: step.headers.filter((_, j) => j !== i) })} />
              </div>
              <div className="flex items-center gap-3">
                <Checkbox checked={isSecret} disabled={!!ref} label={__uiText('ความลับ (เก็บเข้ารหัส ดูย้อนหลังไม่ได้)')}
                  onChange={(e) => setDraftSecret((d) => { const next = { ...d }; if (e.target.checked) next[i] = ''; else delete next[i]; return next; })} />
                {isSecret && <Button size="sm" disabled={busy || !draftSecret[i]} onClick={() => saveSecret(i)}>{ref ? __uiText('เปลี่ยนค่า') : __uiText('บันทึกค่าลับ')}</Button>}
              </div>
            </div>
          );
        })}
        {step.headers.length < meta.limits.maxHeaders && (
          <Button size="sm" icon="add" onClick={() => onChange({ ...step, headers: [...step.headers, { key: '', value: '' }] })}>{__uiText('เพิ่ม header')}</Button>
        )}
      </Field>

      {step.method !== 'GET' && (
        <Field label={__uiText('Body')}>
          <Textarea rows={6} className="font-mono text-xs" value={step.body ?? ''} placeholder={'{"email":"{{user_email}}"}'} onChange={(e) => onChange({ ...step, body: e.target.value })} />
          <div className="mt-1 flex flex-wrap gap-1">
            {meta.templateVars.map((v) => (
              <button key={v.key} type="button" title={v.label} className="rounded border border-outline-variant px-1.5 py-0.5 font-mono text-[11px]"
                onClick={() => onChange({ ...step, body: `${step.body ?? ''}{{${v.key}}}` })}>{`{{${v.key}}}`}</button>
            ))}
          </div>
        </Field>
      )}

      <Button disabled={busy || !step.url} onClick={async () => { setBusy(true); setError(null); try { setResult(await flowsApi.webhookTest(step)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>
        {__uiText('ส่งทดสอบ (ข้อมูลตัวอย่าง)')}
      </Button>
      {result && (
        <div className="rounded-lg bg-surface-container p-2 text-xs">
          <div>{result.error ? __uiText('ไม่สำเร็จ: {0}', { 0: result.error }) : __uiText('ตอบกลับ {0}', { 0: result.status ?? '-' })}</div>
          {result.body && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{result.body}</pre>}
        </div>
      )}
      {error && <Hint>{error}</Hint>}
    </div>
  );
}
```
The secret's plain value only lives in this component's state until saved; it is never put in `step.headers`.

- [ ] **Step 6: `StepPanel.tsx`**

```tsx
// app/pages/marketing-workflow/StepPanel.tsx
import { Button, Panel, PanelHead, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { SegmentOption, WebhookSecretItem, WorkflowInput, WorkflowIssue, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { AudienceForm, ConditionForm, CouponForm, NotifyForm, WaitForm, describeStep, type CouponOption } from './forms/StepForms';
import { SplitForm } from './forms/SplitForm';
import { TriggerForm } from './forms/TriggerForm';
import { WebhookForm } from './forms/WebhookForm';
import { TRIGGER } from './workflow-graph';

export function StepPanel(p: {
  selection: string | null; input: WorkflowInput; meta: WorkflowMeta; issues: WorkflowIssue[]; segments: SegmentOption[]; coupons: CouponOption[];
  secrets: WebhookSecretItem[]; onChangeInput: (patch: Partial<WorkflowInput>) => void; onChangeStep: (s: WorkflowStep) => void;
  onRemoveStep: (id: string) => void; onSecretsChanged: () => void;
}) {
  __useUiLocale();
  const step = p.input.steps.find((s) => s.id === p.selection);
  const issues = p.issues.filter((i) => i.stepId === (p.selection === TRIGGER ? null : p.selection));
  if (!p.selection) {
    return <Panel><PanelHead title={__uiText('ตั้งค่า')} /><p className="p-4 text-sm text-on-surface-variant">{__uiText('เลือกการ์ดบน canvas เพื่อตั้งค่า')}</p></Panel>;
  }
  const title = p.selection === TRIGGER ? __uiText('Entry') : step ? describeStep(step, p).title : '';
  return (
    <Panel>
      <PanelHead title={title} />
      <div className="space-y-4 p-4">
        {issues.map((i) => <p key={i.code} className="rounded bg-error-container px-2 py-1 text-xs text-on-error-container">{i.message}</p>)}
        {p.selection === TRIGGER && <TriggerForm input={p.input} onChange={p.onChangeInput} />}
        {step?.type === 'audience' && <AudienceForm step={step} segments={p.segments} onChange={p.onChangeStep} />}
        {step?.type === 'wait' && <WaitForm step={step} maxMinutes={p.meta.limits.maxWaitMinutes} onChange={p.onChangeStep} />}
        {step?.type === 'condition' && <ConditionForm step={step} meta={p.meta} onChange={p.onChangeStep} />}
        {step?.type === 'split' && <SplitForm step={step} limits={p.meta.limits} onChange={p.onChangeStep} />}
        {step?.type === 'webhook' && <WebhookForm step={step} meta={p.meta} secrets={p.secrets} onChange={p.onChangeStep} onSecretsChanged={p.onSecretsChanged} />}
        {step?.type === 'action' && step.action.kind === 'notify' && <NotifyForm step={step} onChange={p.onChangeStep} />}
        {step?.type === 'action' && step.action.kind === 'grant_coupon' && <CouponForm step={step} coupons={p.coupons} onChange={p.onChangeStep} />}
        {step && <Button variant="ghost" icon="delete" onClick={() => p.onRemoveStep(step.id)}>{__uiText('ลบขั้นตอนนี้')}</Button>}
      </div>
    </Panel>
  );
}
```
Check `PanelHead`'s props and that `bg-error-container` / `text-on-error-container` exist in `theme.css`.

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit` — expect no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/commerce-admin/src/app/pages/marketing-workflow apps/commerce-admin/src/app/pages/workflow-editor/josh
git commit -m "feat(admin): flow step forms — trigger, audience, wait, condition, notify, coupon, A/B split, webhook with stored secrets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: commerce-admin — editor page, results, routes, list, copy

**Files:**
- Create: `app/pages/marketing-workflow/FlowEditorPage.tsx`, `FlowResults.tsx`, `index.tsx`
- Modify: `app/app.tsx`, `app/pages/MarketingWorkflows.tsx`, `libs/ui/src/locales/ui-messages.json`

**Interfaces:**
- Consumes: Tasks 9–11; `marketingTestersApi.list()` (`src/lib/api.ts`), `useAsync` (`src/app/hooks.ts`), `getCoupons` (`workflow-editor/josh/extra.api.ts`).
- Produces: routes `/marketing/flows/new`, `/marketing/flows/:id`.

- [ ] **Step 1: `FlowResults.tsx`**

```tsx
// app/pages/marketing-workflow/FlowResults.tsx
import { useState } from 'react';
import { Button, Empty, ErrorText, Loading, Panel, PanelHead, Table, TBody, TD, TH, THead, TR, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import { flowsApi } from '../../../lib/api';
import { useAsync } from '../../hooks';

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

/** Results tab: totals, per-branch A/B, holdout vs treated, enrollments with their logs. Test runs excluded server-side. */
export function FlowResults({ id }: { id: string }) {
  __useUiLocale();
  const stats = useAsync(() => flowsApi.analytics(id), [id]);
  const [page, setPage] = useState(1);
  const list = useAsync(() => flowsApi.enrollments(id, page), [id, page]);
  const [open, setOpen] = useState<string | null>(null);
  const logs = useAsync(() => (open ? flowsApi.logs(id, open) : Promise.resolve(null)), [id, open]);
  if (stats.loading) return <Loading />;
  if (stats.error || !stats.data) return <ErrorText error={stats.error} />;
  const s = stats.data;
  return (
    <div className="space-y-4">
      <Panel><PanelHead title={__uiText('ภาพรวม')} />
        <div className="grid grid-cols-4 gap-3 p-4 text-sm">
          {Object.entries(s.counts).map(([k, v]) => <div key={k}><div className="text-on-surface-variant">{k}</div><div className="text-xl font-semibold">{v}</div></div>)}
        </div>
        <p className="px-4 pb-4 text-sm">{__uiText('Conversion: ได้รับข้อความ {0} · Holdout {1}', { 0: pct(s.treated.converted, s.treated.enrolled), 1: pct(s.holdout.converted, s.holdout.enrolled) })}</p>
      </Panel>
      {s.splits.map((sp) => (
        <Panel key={sp.stepId}><PanelHead title={__uiText('A/B Split')} />
          <Table><THead><TR><TH>{__uiText('กิ่ง')}</TH><TH kind="num">{__uiText('เข้า')}</TH><TH kind="num">{__uiText('Converted')}</TH><TH kind="num">%</TH></TR></THead>
            <TBody>{sp.branches.map((b) => <TR key={b.branchId}><TD>{b.label}</TD><TD kind="num">{b.entered}</TD><TD kind="num">{b.converted}</TD><TD kind="num">{pct(b.converted, b.entered)}</TD></TR>)}</TBody>
          </Table>
        </Panel>
      ))}
      <Panel><PanelHead title={__uiText('ผลการส่ง')} />
        {s.actions.length ? (
          <Table><THead><TR><TH>{__uiText('ประเภท')}</TH><TH>{__uiText('สถานะ')}</TH><TH kind="num">{__uiText('จำนวน')}</TH></TR></THead>
            <TBody>{s.actions.map((a) => <TR key={`${a.kind}${a.status}`}><TD>{a.kind}</TD><TD>{a.status}</TD><TD kind="num">{a.count}</TD></TR>)}</TBody></Table>
        ) : <Empty>{__uiText('ยังไม่มีการส่ง')}</Empty>}
      </Panel>
      <Panel><PanelHead title={__uiText('ลูกค้าที่เข้า workflow')} />
        {list.data?.rows.length ? (
          <Table><THead><TR><TH>{__uiText('ลูกค้า')}</TH><TH>{__uiText('สถานะ')}</TH><TH kind="time">{__uiText('เริ่ม')}</TH><TH>{__uiText('เหตุผล')}</TH><TH kind="actions" /></TR></THead>
            <TBody>{list.data.rows.map((r) => (
              <TR key={r.id}><TD kind="mono">{r.userId.slice(0, 8)}{r.isTest ? ' (test)' : ''}{r.isHoldout ? ' (holdout)' : ''}</TD><TD>{r.status}</TD><TD kind="time">{r.startedAt}</TD><TD>{r.endReason ?? ''}</TD>
                <TD kind="actions"><Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{__uiText('log')}</Button></TD></TR>
            ))}</TBody></Table>
        ) : <Empty>{__uiText('ยังไม่มีลูกค้าเข้า workflow')}</Empty>}
        {open && logs.data && <pre className="m-4 max-h-60 overflow-auto rounded bg-surface-container p-2 text-xs">{JSON.stringify(logs.data, null, 2)}</pre>}
        {list.data && list.data.total > 50 && (
          <div className="flex gap-2 p-4">
            <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{__uiText('ก่อนหน้า')}</Button>
            <Button size="sm" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>{__uiText('ถัดไป')}</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
```
Check `Empty`'s / `ErrorText`'s props (`error`), and the `fmt` helper in `@cp/ui` for dates — use it for `startedAt` if it exists (`fmt.dateTime(...)` or similar).

- [ ] **Step 2: `FlowEditorPage.tsx`**

```tsx
// app/pages/marketing-workflow/FlowEditorPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Input, Loading, Modal, Page, PageHeader, Segmented, Select, StatusChip, toast, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { SegmentOption, TriggerType, WebhookSecretItem, Workflow, WorkflowInput, WorkflowIssue, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { flowsApi, marketingTestersApi, type MarketingTester } from '../../../lib/api';
import { getCoupons } from '../workflow-editor/josh/extra.api';
import { useAsync } from '../../hooks';
import { FlowCanvas } from './FlowCanvas';
import { FlowResults } from './FlowResults';
import { Palette } from './Palette';
import { StepPanel } from './StepPanel';
import { describeStep, type CouponOption } from './forms/StepForms';
import { describeTrigger, TRIGGER_DEFAULTS } from './forms/TriggerForm';
import { addLoose, autoLayout, connect, disconnect, insertAfter, newStep, removeStep, tailOfMain, TRIGGER, type Anchor, type StepKind } from './workflow-graph';

const BLANK: WorkflowInput = { name: '', triggerType: 'first_login', triggerConfig: {}, entryStepId: null, steps: [], graphUi: null,
  cooldownDays: 0, holdoutPercent: 0, conversionWindowDays: 7, exitOnGoal: { kind: 'order_placed' }, schedule: null };
const inputOf = (w: Workflow): WorkflowInput => ({ name: w.name, triggerType: w.triggerType, triggerConfig: w.triggerConfig, entryStepId: w.entryStepId,
  steps: w.steps, graphUi: w.graphUi, cooldownDays: w.cooldownDays, holdoutPercent: w.holdoutPercent, conversionWindowDays: w.conversionWindowDays,
  exitOnGoal: w.exitOnGoal, schedule: w.schedule });

/** `/marketing/flows/new` creates a draft and redirects; `/marketing/flows/:id` is the journey editor. */
export function FlowEditorPage() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    if (id) return;
    flowsApi.create({ ...BLANK, name: __uiText('Workflow ใหม่') }).then((w) => navigate(`/marketing/flows/${w.id}`, { replace: true }))
      .catch((e) => toast(e instanceof Error ? e.message : String(e)));
  }, [id, navigate]);
  return id ? <Editor id={id} /> : <Loading />;
}

function Editor({ id }: { id: string }) {
  __useUiLocale();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [input, setInput] = useState<WorkflowInput>(BLANK);
  const [dirty, setDirty] = useState(false);
  const [meta, setMeta] = useState<WorkflowMeta | null>(null);
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [secrets, setSecrets] = useState<WebhookSecretItem[]>([]);
  const [selection, setSelection] = useState<string | null>(TRIGGER);
  const [tab, setTab] = useState<'flow' | 'results'>('flow');
  const [issues, setIssues] = useState<WorkflowIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    const [w, m, segs, secs, couponRes] = await Promise.all([flowsApi.get(id), flowsApi.meta(), flowsApi.segmentOptions(), flowsApi.secrets.list(), getCoupons(1, 200, '')]);
    setWf(w); setInput(inputOf(w)); setIssues(w.issues); setMeta(m); setSegments(segs); setSecrets(secs); setDirty(false);
    setCoupons(((couponRes?.data?.data?.data ?? []) as CouponOption[]).map((c) => ({ id: c.id, coupon_code: c.coupon_code, title: c.title })));
  }, [id]);
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = (p: Partial<WorkflowInput>) => { setInput((cur) => ({ ...cur, ...p })); setDirty(true); };
  const graph = useMemo(() => ({ entryStepId: input.entryStepId, steps: input.steps }), [input.entryStepId, input.steps]);
  const applyGraph = (g: { entryStepId: string | null; steps: WorkflowStep[] }) => patch({ entryStepId: g.entryStepId, steps: g.steps });
  const insert = (kind: StepKind, anchor: Anchor) => { const s = newStep(kind); applyGraph(insertAfter(graph, anchor, s)); setSelection(s.id); };
  const pickFromPalette = (itemId: string, trigger?: boolean) => {
    if (trigger) { patch({ triggerType: itemId as TriggerType, triggerConfig: TRIGGER_DEFAULTS[itemId as TriggerType] }); setSelection(TRIGGER); return; }
    const anchor: Anchor = selection && selection !== TRIGGER && input.steps.some((s) => s.id === selection)
      ? { stepId: selection, port: undefined } : selection === TRIGGER ? { stepId: TRIGGER } : tailOfMain(graph);
    insert(itemId as StepKind, anchor);
  };

  const run = async (fn: () => Promise<Workflow>, done: string) => {
    setBusy(true); setError(null);
    try { const w = await fn(); setWf(w); setInput(inputOf(w)); setIssues(w.issues); setDirty(false); toast(done); }
    catch (e) {
      const details = (e as { details?: { issues?: WorkflowIssue[] } }).details;
      if (details?.issues) setIssues(details.issues);
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const save = () => run(() => flowsApi.update(id, input), __uiText('บันทึกแล้ว'));

  if (error && !wf) return <Page><Alert tone="error">{error}</Alert></Page>;
  if (!wf || !meta) return <Loading />;
  const issuesByStep = Object.fromEntries(issues.map((i) => [i.stepId ?? TRIGGER, i.message]));
  const trig = describeTrigger(input.triggerType, input.triggerConfig);

  return (
    <Page>
      <PageHeader title={<Input value={input.name} onChange={(e) => patch({ name: e.target.value })} aria-label={__uiText('ชื่อ workflow')} className="text-lg font-semibold" />}
        actions={<div className="flex items-center gap-2">
          <StatusChip status={wf.status} />
          <Button disabled={busy || !dirty} onClick={save}>{__uiText('บันทึก')}</Button>
          <Button disabled={busy} onClick={() => setTestOpen(true)}>{__uiText('รันทดสอบ')}</Button>
          <Button variant="ghost" onClick={() => setHistoryOpen(true)}>{__uiText('ประวัติ')}</Button>
          {wf.status === 'active'
            ? <Button variant="ghost" disabled={busy} onClick={() => run(() => flowsApi.pause(id), __uiText('หยุดแล้ว'))}>{__uiText('Pause')}</Button>
            : <Button variant="primary" disabled={busy} onClick={async () => { if (dirty) await flowsApi.update(id, input); await run(() => flowsApi.activate(id), __uiText('เปิดใช้แล้ว')); }}>{__uiText('Activate')}</Button>}
        </div>} />
      {error && <Alert tone="error">{error}</Alert>}
      {issues.length > 0 && <Alert tone="warning">{__uiText('ยังเปิดใช้ไม่ได้: {0} จุดที่ต้องแก้ (การ์ดขอบแดง)', { 0: issues.length })}</Alert>}
      <Segmented value={tab} onChange={(v: string) => setTab(v as 'flow' | 'results')} options={[{ value: 'flow', label: __uiText('Flow') }, { value: 'results', label: __uiText('ผลลัพธ์') }]} />
      {tab === 'results' ? <FlowResults id={id} /> : (
        <div className="mt-3 flex h-[72vh] min-h-[560px] gap-3">
          <Palette steps={input.steps} triggerType={input.triggerType} limits={meta.limits} onPick={(item) => pickFromPalette(item.id, item.trigger)} />
          <div className="relative min-w-0 flex-1">
            <FlowCanvas graph={graph} positions={input.graphUi ?? {}} triggerType={input.triggerType} triggerTitle={trig.title} triggerSubtitle={trig.subtitle}
              selectedId={selection} issuesByStep={issuesByStep} limits={meta.limits} describe={(s) => describeStep(s, { segments, coupons })}
              onSelect={setSelection} onMove={(sid, pos) => patch({ graphUi: { ...(input.graphUi ?? {}), [sid]: pos } })}
              onInsert={insert} onAddLoose={(kind, pos) => { const s = newStep(kind); patch({ steps: addLoose(graph, s).steps, graphUi: { ...(input.graphUi ?? {}), [s.id]: pos } }); setSelection(s.id); }}
              onConnect={(from, to) => applyGraph(connect(graph, from, to))} onDisconnect={(from) => applyGraph(disconnect(graph, from))}
              onRemove={(sid) => { applyGraph(removeStep(graph, sid)); setSelection(null); }}
              onPickTrigger={(t) => pickFromPalette(t, true)} />
            <Button size="sm" className="absolute right-3 top-3" onClick={() => patch({ graphUi: autoLayout(graph) })}>{__uiText('จัดเรียงอัตโนมัติ')}</Button>
          </div>
          <div className="w-80 shrink-0 overflow-y-auto">
            <StepPanel selection={selection} input={input} meta={meta} issues={issues} segments={segments} coupons={coupons} secrets={secrets}
              onChangeInput={patch} onChangeStep={(s) => patch({ steps: input.steps.map((x) => (x.id === s.id ? s : x)) })}
              onRemoveStep={(sid) => { applyGraph(removeStep(graph, sid)); setSelection(null); }}
              onSecretsChanged={() => flowsApi.secrets.list().then(setSecrets)} />
          </div>
        </div>
      )}
      {testOpen && <TestRunModal id={id} dirty={dirty} onSave={save} onClose={() => setTestOpen(false)} />}
      {historyOpen && <RevisionsModal id={id} onLoad={(snapshot) => { setInput(snapshot); setDirty(true); setHistoryOpen(false); }} onClose={() => setHistoryOpen(false)} />}
    </Page>
  );
}

/** Saved versions (newest first); "เปิดฉบับนี้" loads it into the editor unsaved — Save makes it current. */
function RevisionsModal({ id, onLoad, onClose }: { id: string; onLoad: (snapshot: WorkflowInput) => void; onClose: () => void }) {
  __useUiLocale();
  const list = useAsync(() => flowsApi.revisions(id), [id]);
  return (
    <Modal title={__uiText('ประวัติการแก้ไข')} onClose={onClose} footer={<Button onClick={onClose}>{__uiText('ปิด')}</Button>}>
      {list.loading ? <Loading /> : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded border border-outline-variant px-3 py-2">
              <span>{new Date(r.createdAt).toLocaleString()} · {r.createdBy ?? '-'} · {r.snapshot.steps.length} steps</span>
              <Button size="sm" onClick={() => onLoad(r.snapshot)}>{__uiText('เปิดฉบับนี้')}</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function TestRunModal({ id, dirty, onSave, onClose }: { id: string; dirty: boolean; onSave: () => Promise<void>; onClose: () => void }) {
  __useUiLocale();
  const [testers, setTesters] = useState<MarketingTester[]>([]);
  const [userId, setUserId] = useState('');
  const [skipWaits, setSkipWaits] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { marketingTestersApi.list().then((t) => { setTesters(t); setUserId(t[0]?.userId ?? ''); }); }, []);
  const start = async () => {
    setMsg(null);
    try {
      if (dirty) await onSave();
      const r = await flowsApi.testRun(id, userId, skipWaits);
      setMsg(r.enrollmentId ? __uiText('เริ่มแล้ว — ดูผลที่แท็บผลลัพธ์ (test)') : __uiText('ไม่ได้เริ่ม'));
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Modal title={__uiText('รันทดสอบกับ tester')} onClose={onClose}
      footer={<><Button onClick={onClose}>{__uiText('ปิด')}</Button><Button variant="primary" disabled={!userId} onClick={start}>{__uiText('ส่งจริงให้ tester')}</Button></>}>
      {testers.length ? (
        <div className="space-y-3">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>{testers.map((t) => <option key={t.userId} value={t.userId}>{t.name ?? t.email} · {t.email}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipWaits} onChange={(e) => setSkipWaits(e.target.checked)} />{__uiText('ข้าม Time Delay')}</label>
          <p className="text-xs text-on-surface-variant">{__uiText('ส่งจริง (push / email / คูปองผ่าน josh, webhook ยิงจริง) เฉพาะ tester ที่เลือก')}</p>
        </div>
      ) : <p className="text-sm">{__uiText('ยังไม่มี tester — เพิ่มได้ที่หน้า ข้อความอัตโนมัติ › Tester')}</p>}
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </Modal>
  );
}
```
Check the real prop names of `PageHeader` (`title` / `actions`), `Alert` (`tone`), `Segmented` (`value`, `onChange`, `options`), `StatusChip` (`status` or `tone`), `Modal` (`title`, `onClose`, `footer`) in `libs/ui/src/index.tsx` and adapt. `request()` in `lib/api.ts` attaches `details: body?.error ?? body` to thrown errors — the activate 422 body is `{ message, issues }` (wrapped by `AllExceptionsFilter` as `{ statusCode, path, error }`): read issues from `details.issues` or `details.message.issues`, whichever the filter produces (check `all-exceptions.filter.ts:41-45`).

- [ ] **Step 3: Routes + list**

`app/pages/marketing-workflow/index.tsx`:
```tsx
import { TaskPageFrame } from '@cp/ui';
import { FlowEditorPage } from './FlowEditorPage';

export function FlowEditor() { return <TaskPageFrame><FlowEditorPage /></TaskPageFrame>; }
```
In `app/app.tsx`: `import { FlowEditor } from './pages/marketing-workflow';` and, next to the `/marketing/workflows/...` routes (~L237), add
```tsx
<Route path="/marketing/flows/new" element={<FlowEditor />} />
<Route path="/marketing/flows/:id" element={<FlowEditor />} />
```
In `MarketingWorkflows.tsx`:
- change the create button (`~L57`) to `to="/marketing/flows/new"`;
- above the existing josh table add a `<Panel>` "Workflow ของ commerce (ใหม่)" that renders `useAsync(() => flowsApi.list(), [])` as a table (name → `ButtonLink to={`/marketing/flows/${w.id}`}`, status, trigger, enrolled30d, converted30d, updatedAt), with an `Empty` state "ยังไม่มี — กดสร้าง workflow ใหม่";
- retitle the existing josh panel "Workflow ของ josh".

- [ ] **Step 4: Copy entries**

List new literals and add `{th, en}` for every missing one:
```bash
node -e '
const fs=require("fs"),path=require("path");
const dict=JSON.parse(fs.readFileSync("libs/ui/src/locales/ui-messages.json","utf8"));
const keys=new Set(Object.keys(dict.messages ?? dict));
const dir="apps/commerce-admin/src/app/pages/marketing-workflow"; const files=[];
(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):/\.tsx?$/.test(f)&&!f.includes(".spec.")&&files.push(p);}})(dir);
files.push("apps/commerce-admin/src/app/pages/MarketingWorkflows.tsx");
const found=new Set(); for(const f of files){const s=fs.readFileSync(f,"utf8"); for(const m of s.matchAll(/uiText\(\s*(["\x27])((?:\\.|(?!\1).)*)\1/g)) found.add(m[2]);}
console.log([...found].filter(k=>!keys.has(k)).join("\n"));'
```
Open `ui-messages.json`, follow its existing entry shape exactly, and add each printed key with Thai `th` and an English `en` (no Thai characters in `en`, same `{0}` placeholders). Re-run the script: expect no output. Run `npx vitest run apps/commerce-admin/src/app/navigation.spec.ts --config apps/commerce-admin/vite.config.mts` — PASS.

- [ ] **Step 5: Typecheck + tests**

```bash
npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit
npx nx test commerce-admin
```

- [ ] **Step 6: Commit**

```bash
git add apps/commerce-admin libs/ui/src/locales/ui-messages.json
git commit -m "feat(admin): journey editor page for commerce flows — palette, canvas, panel, results, tester test-run; list shows commerce and josh groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end verification, docs, completion note

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-marketing-workflow-builder-design.md` (only if implementation deviated — record each deviation in a short "Implementation notes" section)
- Create: `.claude/completions/2026-10-10-marketing-workflow-phase1.md`

- [ ] **Step 1: Full test + type runs**

```bash
npx nx test commerce-platform
npx nx test commerce-admin
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit
```
(josh was verified in Task 1 Step 10.) Expected: all green. Paste failures into the task report if any remain.

- [ ] **Step 2: Local stack in the browser**

Start the local stack following `README.md` (commerce-platform API on :3100 with Postgres + Redis, migrations run; `npm run dev:admin` on :4403), with `MARKETING_WEBHOOK_SECRETS_KEY=$(openssl rand -base64 32)` set. In the built-in browser at `http://localhost:4403/marketing/flows/new`:
1. A draft opens on the editor; palette on the left shows ENTRY / CHANNELS / FLOW / REWARDS; the canvas shows the Entry card and the empty-state hint.
2. Drag **Push** onto the Entry card → a card appears to its right, connected. Click **A/B Split** in the palette → appended after Push. Use the `+` on branch B → popover → **Webhook** → connected to B.
3. Webhook form: URL `http://127.0.0.1/x` shows the warning; set `https://webhook.site/<your-id>` (or any request bin); add header `Authorization`, tick "ความลับ", type a value, "บันทึกค่าลับ" → the field shows `•••• (name)`. "ส่งทดสอบ" → status 200 and the bin shows the header with the real value.
4. Activate with the Push template empty → warning + red card; pick a template → Save → Activate → status active.
5. Reload → same graph, positions and secret display. "จัดเรียงอัตโนมัติ" lays cards out left → right.
6. Check the network tab and the saved workflow JSON (`GET /api/marketing/flows/:id`): the secret value appears nowhere.
Take a screenshot of the finished canvas for the report.

- [ ] **Step 3: Real send to the tester (staging, then prod per rollout)**

On staging (josh receiver deployed, subscription types added): add the josh account whose email is **pongpanot_s@jagota.co.th** as a tester; build `first_login` → Email (a test template) → A/B Split → Webhook (request bin); "รันทดสอบ" with that tester, "ข้าม Time Delay" on. Expected: the email arrives at pongpanot_s@jagota.co.th, the bin receives the webhook with the resolved secret header, the Results tab lists the test enrollment with its logs, and `webhook_failures` (MCP) shows nothing for it. Do not do this on prod until the user says the rollout steps 1–3 are done.

- [ ] **Step 4: Completion note + spec notes**

Known deviations to record in the spec's "Implementation notes": (a) `marketing.grant_coupon` carries only `{ userId, couponId }` — josh's grant is already idempotent per coupon + user and the controller dedupes on `x-delivery-id`, so no idempotencyKey; (b) at run time the engine checks only the URL's scheme, the DNS-based SSRF check runs at save/activate (static URLs) and at send; (c) enrollments are shown inside the Results tab, not a separate tab; (d) `is_test`, `skip_waits` and `last_scheduled_key` columns were added for test runs and scheduled resumes.

Write `.claude/completions/2026-10-10-marketing-workflow-phase1.md`: what shipped (commits per repo), how to roll out (spec §7 with the exact `josh-subscription.cjs` command and the env var), what was verified (commands + browser + real send or "not yet"), known limits (frequency cap split across systems; no delivery feedback from josh; scheduled scan cost; DNS rebinding window). If anything differs from the spec, add an "Implementation notes" section to the spec listing each difference.

- [ ] **Step 5: Commit**

```bash
git add .claude/completions docs/superpowers/specs
git commit -m "docs(marketing-workflow): phase 1 completion note and implementation notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Do not push either repo; tell the user both branches are ready (commerce `claude/marketing-workflow-0f1cc5`, josh `feat/commerce-marketing-receiver`) and the rollout order.
