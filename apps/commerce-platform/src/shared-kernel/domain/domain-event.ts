import { randomUUID } from 'crypto';

/**
 * Base class for internal domain events. Subclasses declare a stable `type`
 * string (e.g. `customer.created`) used for routing across the event bus and
 * the transactional outbox.
 */
export abstract class DomainEvent<P = unknown> {
  readonly eventId: string = randomUUID();
  readonly occurredAt: Date = new Date();
  abstract readonly type: string;

  constructor(
    public readonly aggregateId: string,
    public readonly payload: P,
    public readonly metadata: Record<string, unknown> = {},
  ) {}
}
