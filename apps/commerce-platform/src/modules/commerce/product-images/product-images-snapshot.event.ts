import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';

/** `product.images.snapshot` (stage 4e): one SKU's gallery URLs in display order. Latest wins. */
export class ProductImagesSnapshot extends DomainEvent<{ sku: string; images: string[]; version: string }> {
  readonly type = 'product.images.snapshot';
  constructor(payload: { sku: string; images: string[]; version: string }) {
    super(skuAggregateId(payload.sku, 'images'), payload, { snapshot: true });
  }
}
