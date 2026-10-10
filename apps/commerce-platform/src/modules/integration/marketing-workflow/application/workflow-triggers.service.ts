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
