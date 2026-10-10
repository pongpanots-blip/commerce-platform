import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowQueue } from './workflow-queue';

/**
 * josh-events applied a snapshot → a job checks triggers (never inside josh-events' own transaction).
 * PDPA deletes are not here: josh-events runs stopMarketingForCustomer in its own transaction.
 */
@Injectable()
export class WorkflowTriggerListener {
  constructor(private readonly queue: WorkflowQueue) {}

  @OnEvent('marketing-trigger.customer') customer(p: { userId: string }) { this.queue.trigger('customer', p.userId); }
  @OnEvent('marketing-trigger.order') order(p: { userId: string }) { this.queue.trigger('order', p.userId); }
  @OnEvent('marketing-trigger.events') events(p: { eventIds: string[] }) { this.queue.events(p.eventIds); }
}
