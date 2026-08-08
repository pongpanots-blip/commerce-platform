import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class PriceUpdated extends DomainEvent<{ id: string }> {
  readonly type = 'price.updated';
}
