import { EntityManager } from 'typeorm';
import { DomainEvent } from '../domain/domain-event';

export const EVENT_BUS = Symbol('EVENT_BUS');

/**
 * Publishes domain events. When a transactional {@link EntityManager} is passed,
 * the event is persisted to the outbox in that SAME transaction (transactional
 * outbox pattern) so the event can never be lost if the process dies before the
 * async relay picks it up.
 */
export interface IEventBus {
  publish(event: DomainEvent, manager?: EntityManager): Promise<void>;
}
