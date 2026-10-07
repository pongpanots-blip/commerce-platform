import { createHash } from 'crypto';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event';

export interface ProductPriceSnapshotPayload {
  sku: string;
  sellingUnitPrice: number | null;
  orderingPrice: number | null;
  moq: number | null;
  /** When commerce's price for this SKU changed (ISO) — platforms keep the newest. */
  version: string;
}

/** A stable uuid per SKU for the outbox aggregate (prices are keyed by SKU, the outbox by uuid). */
export function skuAggregateId(sku: string): string {
  const h = createHash('md5').update(`price:${sku}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** `product.price.snapshot` (stage 4a): one SKU's base price, ERP box price and MOQ as commerce has them. Latest wins. */
export class ProductPriceSnapshot extends DomainEvent<ProductPriceSnapshotPayload> {
  readonly type = 'product.price.snapshot';
  constructor(payload: ProductPriceSnapshotPayload) {
    super(skuAggregateId(payload.sku), payload, { snapshot: true });
  }
}
