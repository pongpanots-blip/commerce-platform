import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

/**
 * Canonical stock event every subscribed platform receives (docs/event-contract.md).
 * aggregateId = platform product id. Same shape whoever owns the warehouse:
 * `source` says who — 'erp' (ERP feed) or 'commerce' (a warehouse commerce runs
 * itself) — and `erp` is the item in the ERP feed format (UPPER_SNAKE) either way,
 * so a platform that already handles ERP stock (josh) needs no change when a
 * warehouse moves from the ERP to commerce. metadata.snapshot = latest wins.
 */
export interface InventoryQtyPayload {
  sku: string;
  source: 'erp' | 'commerce';
  warehouseCode: string;
  quantity: number;
  previousQuantity: number;
  reason: string | null;
  changedAt: string;
  erp: unknown;
  /** erp: the erp_ingest_records id · commerce: the inventory_movements id */
  ingestRecordId?: string;
  movementId?: string;
  [key: string]: unknown;
}

export class InventoryQtyChanged extends DomainEvent<InventoryQtyPayload> {
  readonly type = 'inventory.qty.changed';
  constructor(aggregateId: string, payload: InventoryQtyPayload) { super(aggregateId, payload, { snapshot: true }); }
}
