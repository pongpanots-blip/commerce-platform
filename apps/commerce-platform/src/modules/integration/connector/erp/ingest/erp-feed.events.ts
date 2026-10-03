import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

/**
 * Canonical events every subscribed platform receives (docs/erp-integration-tasks.md §0.1).
 * aggregateId = platform product id · payload carries the SKU, the normalized
 * values, and the ERP item verbatim (`erp`) so a platform can reuse its own
 * ERP handler without re-mapping. metadata.snapshot marks them latest-wins:
 * an older undelivered event for the same product is superseded by a newer one.
 */
export interface FeedEventPayload {
  sku: string;
  ingestRecordId: string;
  changedAt: string;
  erp: unknown;
  [key: string]: unknown;
}

const SNAPSHOT = { snapshot: true };

export class InventoryQtyChanged extends DomainEvent<FeedEventPayload> {
  readonly type = 'inventory.qty.changed';
  constructor(aggregateId: string, payload: FeedEventPayload) { super(aggregateId, payload, SNAPSHOT); }
}

export class ProductPriceChanged extends DomainEvent<FeedEventPayload> {
  readonly type = 'product.price.changed';
  constructor(aggregateId: string, payload: FeedEventPayload) { super(aggregateId, payload, SNAPSHOT); }
}

export class ProductMoqChanged extends DomainEvent<FeedEventPayload> {
  readonly type = 'product.moq.changed';
  constructor(aggregateId: string, payload: FeedEventPayload) { super(aggregateId, payload, SNAPSHOT); }
}
