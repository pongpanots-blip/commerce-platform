import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';

export interface InventorySellableSnapshotPayload {
  sku: string;
  /** Σ max(0, quantity − reserved) over the product's sellable warehouses. */
  sellableQty: number;
  /** When the latest movement behind this number happened (ISO) — the version platforms compare. */
  version: string;
  /** The same number as one ERP qty item, for a platform that takes ERP-shaped stock. */
  erp: { PRODUCT_CODE: string; QUANTITY: number; CHANGED_AT: string };
}

/**
 * `inventory.sellable.snapshot` (stage 3, spec §3.2): one stock number per SKU — what a storefront may sell — after any
 * applied movement in any warehouse. Latest-state; platforms keep the newest `version`.
 */
export class InventorySellableSnapshot extends DomainEvent<InventorySellableSnapshotPayload> {
  readonly type = 'inventory.sellable.snapshot';
  constructor(productId: string, payload: InventorySellableSnapshotPayload) {
    super(productId, payload, { snapshot: true });
  }
}
