import { Injectable } from '@nestjs/common';
import { DEFAULT_MARKETING_TIMEZONE, isScheduledFireDue, localDateKey } from '../domain/schedule';
import type { EventTriggerConfig, OrderMilestoneTriggerConfig, ScheduledTriggerConfig } from '../domain/workflow.types';
import { matchesFilters } from '../../marketing-events/domain/event-filter';
import { EventRuleService } from '../../marketing-events/application/event-rule.service';
import { MarketingWorkflowRow } from '../infrastructure/marketing-workflow.entity';
import { WorkflowStore } from '../infrastructure/workflow.store';
import { WorkflowEngine } from './workflow-engine.service';

/**
 * A snapshot only counts for an event this recent. A login / order the trigger could not enroll at the time (outside
 * the schedule, in cooldown, not in the audience) must not enroll on some unrelated later snapshot (a profile edit
 * next week). josh delivers snapshots within seconds; the margin covers a short josh/commerce outage.
 */
export const TRIGGER_RECENT_MINUTES = 60;

/** Which commerce workflows a josh snapshot (or the clock) enrolls a customer into (spec §3.3). */
@Injectable()
export class WorkflowTriggers {
  constructor(private readonly store: WorkflowStore, private readonly engine: WorkflowEngine, private readonly rules: EventRuleService) {}

  async handle(kind: 'customer' | 'order', userId: string, now = new Date()): Promise<void> {
    if (kind === 'order') await this.store.markConverted(userId);
    const workflows = await this.store.activeWorkflows(kind === 'customer' ? ['first_login', 'app_login'] : ['order_milestone']);
    for (const wf of workflows) {
      const key = await this.occurrence(wf, userId, now);
      if (key) await this.engine.enroll(wf, userId, key);
    }
  }

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

  private async occurrence(wf: MarketingWorkflowRow, userId: string, now: Date): Promise<string | null> {
    if (!wf.activatedAt) return null;
    const recent = new Date(now.getTime() - TRIGGER_RECENT_MINUTES * 60_000);
    const since = wf.activatedAt > recent ? wf.activatedAt : recent;
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
