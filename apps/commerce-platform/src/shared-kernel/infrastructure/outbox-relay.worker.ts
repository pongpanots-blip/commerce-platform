import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { OutboxMessage } from './outbox.entity';
import { QUEUES } from '../../config/redis.config';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

/**
 * Drains pending outbox rows: emits each event in-process (EventEmitter2) for
 * local handlers AND enqueues it on the durable BullMQ outbox queue, then marks
 * the row published. Failures increment `attempts` and flip to `failed` past the
 * max, so a poison row cannot wedge the relay.
 */
@Injectable()
export class OutboxRelayWorker {
  private readonly logger = new Logger(OutboxRelayWorker.name);

  constructor(
    @InjectRepository(OutboxMessage)
    private readonly outboxRepo: Repository<OutboxMessage>,
    private readonly emitter: EventEmitter2,
    @InjectQueue(QUEUES.OUTBOX) private readonly queue: Queue,
  ) {}

  @Interval(2000)
  async processPending(): Promise<void> {
    const pending = await this.outboxRepo.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
      take: BATCH_SIZE,
    });

    for (const row of pending) {
      try {
        this.emitter.emit(row.type, {
          eventId: row.id,
          type: row.type,
          aggregateId: row.aggregateId,
          payload: row.payload,
          metadata: row.metadata,
          occurredAt: row.createdAt,
        });
        await this.queue.add('publish', {
          outboxId: row.id,
          type: row.type,
          aggregateId: row.aggregateId,
          payload: row.payload,
        });
        row.status = 'published';
        row.publishedAt = new Date();
        await this.outboxRepo.save(row);
      } catch (error) {
        row.attempts += 1;
        if (row.attempts >= MAX_ATTEMPTS) {
          row.status = 'failed';
          this.logger.error(
            `Outbox row ${row.id} (${row.type}) failed after ${row.attempts} attempts`,
            error instanceof Error ? error.stack : String(error),
          );
        }
        await this.outboxRepo.save(row);
      }
    }
  }
}
