import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MARKETING_WEBHOOK_JOB_OPTIONS, QUEUES } from '../../../../config/redis.config';

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
  /** `again`: a re-queue of a row whose earlier job may still be kept by BullMQ (sweep) — needs its own jobId. */
  webhook(deliveryId: string, again = false): void {
    this.webhooks.add('deliver', { deliveryId }, { ...MARKETING_WEBHOOK_JOB_OPTIONS, jobId: again ? `wh_${deliveryId}_${Date.now()}` : `wh_${deliveryId}` })
      .catch((e) => this.logger.warn(`enqueue webhook ${deliveryId}: ${e}`));
  }
}
