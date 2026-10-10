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
