import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { IEventBus } from '../interfaces/event-bus.interface';
import { DomainEvent } from '../domain/domain-event';
import { OutboxMessage } from './outbox.entity';

/**
 * Event bus that persists every event to the transactional outbox. When a
 * caller supplies the transaction's EntityManager, the outbox insert joins that
 * transaction; otherwise it uses the default repository connection.
 *
 * Actual dispatch (in-process + BullMQ) happens later in the relay worker.
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
  }
}
