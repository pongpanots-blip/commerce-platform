import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export class InventoryUpdated extends DomainEvent<{ id: string; quantity?: number; reserved?: number }> {
  readonly type = 'inventory.updated';
}
