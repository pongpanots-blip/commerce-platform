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
