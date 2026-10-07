import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';

export interface ProductContentSnapshotPayload {
  sku: string;
  /** Every content key commerce holds for this SKU (content-fields.ts); a key not here is still josh's value. */
  fields: Record<string, unknown>;
  /** When commerce's content for this SKU changed (ISO) — platforms keep the newest. */
  version: string;
}

/** `product.content.snapshot` (stage 4b): one SKU's content as commerce has it. Latest wins. */
export class ProductContentSnapshot extends DomainEvent<ProductContentSnapshotPayload> {
  readonly type = 'product.content.snapshot';
  constructor(payload: ProductContentSnapshotPayload) {
    super(skuAggregateId(payload.sku, 'content'), payload, { snapshot: true });
  }
}
