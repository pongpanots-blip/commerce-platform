import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { IEventBus } from '../interfaces/event-bus.interface';
import { DomainEvent } from '../domain/domain-event';
import { OutboxMessage } from './outbox.entity';
import { OUTBOX_CHANNEL } from './outbox-relay.worker';

/**
 * Event bus that persists every event to the transactional outbox. When a
 * caller supplies the transaction's EntityManager, the outbox insert joins that
 * transaction; otherwise it uses the default repository connection.
 *
 * Dispatch happens in the relay worker, woken by a NOTIFY that Postgres only
 * delivers once this transaction commits — no 2s polling delay, and never for a
 * row that was rolled back.
 */
@Injectable()
export class EventEmitterBus implements IEventBus {
  constructor(
    @InjectRepository(OutboxMessage)
    private readonly outboxRepo: Repository<OutboxMessage>,
  ) {}

  async publish(event: DomainEvent, manager?: EntityManager): Promise<void> {
    const repo = manager
      ? manager.getRepository(OutboxMessage)
      : this.outboxRepo;

    await repo.save(
      repo.create({
        type: event.type,
        aggregateId: event.aggregateId,
        payload: event.payload,
        metadata: event.metadata,
        status: 'pending',
        attempts: 0,
        publishedAt: null,
      }),
    );
    await repo.query(`SELECT pg_notify('${OUTBOX_CHANNEL}', '')`);
  }
}
