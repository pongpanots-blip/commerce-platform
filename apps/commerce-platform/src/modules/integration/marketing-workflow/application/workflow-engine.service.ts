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
import { eventVars, renderWebhook, webhookVars } from '../domain/template';
import { GUEST_PUSH_DAILY_CAP } from '../domain/workflow.types';
import { matchesFilters } from '../../marketing-events/domain/event-filter';
import { EventRuleService } from '../../marketing-events/application/event-rule.service';
import type { TriggerEvent, WorkflowAction, WorkflowStep } from '../domain/workflow.types';
import { MarketingWorkflowRow } from '../infrastructure/marketing-workflow.entity';
import { EnrollmentRecord, WorkflowStore, type Who } from '../infrastructure/workflow.store';
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
    private readonly rules: EventRuleService,
  ) {}

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
        case 'action':
        case 'webhook': {
          const kind = step.type === 'webhook' ? 'webhook' : step.action.kind;
          if (await this.goalReached(r)) { await this.store.log(m, e.id, step.id, kind, 'skipped', { reason: 'goal_reached' }); return end('skipped', 'goal_reached'); }
          if (!e.isTest && e.userId && !(await this.passesAudience(wf, e.userId, m))) {
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
    const g = wf.exitOnGoal;
    if (!g) return false;
    if (g.kind === 'order_placed') return !!e.userId && (await this.store.hasCountedOrderSince(m, e.userId, e.startedAt));
    const rows = await this.store.eventsSince(m, { userId: e.userId, deviceId: e.deviceId }, g.eventName, e.startedAt);
    if (!rows.length) return false;
    const types = await this.rules.typesOf(g.eventName);
    return rows.some((r) => matchesFilters(r.attributes, g.filters ?? [], types, e.triggerEvent?.attributes ?? null));
  }

  private async condition({ m, wf, e }: Run, source: string): Promise<boolean> {
    if (!e.userId) return false;
    const checked = checkExpression(source);
    if (!('node' in checked)) return false;
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

  private async capReached(m: EntityManager, userId: string): Promise<boolean> {
    const cap = await this.settings.get<{ enabled?: boolean; maxPerUserPerDay?: number }>('marketing_workflow', 'frequency_cap');
    if (!cap?.enabled || !cap.maxPerUserPerDay) return false;
    return (await this.store.notifiesQueuedToday(m, userId)) >= cap.maxPerUserPerDay;
  }

  /** Renders now (values of this moment), sends later. Full SSRF / DNS check happens in the worker at send time. */
  private async webhook({ m, wf, e, deliveries }: Run, step: Extract<WorkflowStep, { type: 'webhook' }>): Promise<void> {
    const device = e.deviceId ? await this.store.devicePush(m, e.deviceId) : null;
    const vars = { ...webhookVars(e.userId ? await this.store.customerData(m, e.userId) : null,
      { userId: e.userId ?? '', workflowId: wf.id, workflowName: wf.name, enrollmentId: e.id, stepId: step.id }),
      ...eventVars(e.triggerEvent, e.deviceId && device ? { id: e.deviceId, platform: device.platform } : null) };
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
