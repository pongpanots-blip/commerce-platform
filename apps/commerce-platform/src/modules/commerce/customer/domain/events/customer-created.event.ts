import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class CustomerCreated extends DomainEvent<{ id: string }> {
  readonly type = 'customer.created';
}
