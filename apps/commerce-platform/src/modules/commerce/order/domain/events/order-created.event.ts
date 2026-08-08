import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class OrderCreated extends DomainEvent<{ id: string }> {
  readonly type = 'order.created';
}
