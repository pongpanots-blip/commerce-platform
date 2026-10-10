import { Injectable, Logger } from '@nestjs/common';
import { WorkflowStore } from '../infrastructure/workflow.store';
import { WorkflowQueue } from './workflow-queue';
import { WorkflowTriggers } from './workflow-triggers.service';
import { ScheduledInterval } from '../../../../shared-kernel/infrastructure/scheduled-task';

/** Off only with CRON_MARKETING_WORKFLOW_ENABLED=false|0 (no workflow runs until staff activates one). */
const enabled = () => !['false', '0'].includes((process.env.CRON_MARKETING_WORKFLOW_ENABLED ?? '').trim().toLowerCase());

/** Every minute: due waits, lost first jobs, stale webhook rows (backstop for Redis outages), scheduled triggers. */
@Injectable()
export class WorkflowSweep {
  private readonly logger = new Logger(WorkflowSweep.name);
  private running = false;
  constructor(private readonly store: WorkflowStore, private readonly queue: WorkflowQueue, private readonly triggers: WorkflowTriggers) {}

  @ScheduledInterval('marketing-workflow-sweep', 60_000)
  async tick(): Promise<void> {
    if (!enabled() || this.running) return;
    this.running = true;
    try {
      for (const id of await this.store.dueEnrollmentIds(500)) this.queue.step(id);
      for (const id of await this.store.stalePendingWebhookIds(200)) this.queue.webhook(id, true);
      await this.triggers.runScheduled();
    } catch (e) {
      this.logger.error(`marketing workflow sweep: ${e instanceof Error ? e.stack : e}`);
    } finally {
      this.running = false;
    }
  }
}
