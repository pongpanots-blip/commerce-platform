import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class SupplierUpdated extends DomainEvent<{ id: string }> {
  readonly type = 'supplier.updated';
}
