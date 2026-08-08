import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class OrderConfirmed extends DomainEvent<{ id: string }> {
  readonly type = 'order.confirmed';
}
