import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class ProductUpdated extends DomainEvent<{ id: string }> {
  readonly type = 'product.updated';
}
