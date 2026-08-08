import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class OrderCancelled extends DomainEvent<{ id: string }> {
  readonly type = 'order.cancelled';
}
