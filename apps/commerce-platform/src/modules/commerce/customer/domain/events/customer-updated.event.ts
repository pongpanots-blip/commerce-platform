import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class CustomerUpdated extends DomainEvent<{ id: string }> {
  readonly type = 'customer.updated';
}
