import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';

/** `product.master.snapshot` (stage 4d): every master key commerce holds for one SKU (master-fields.ts). Latest wins. */
export class ProductMasterSnapshot extends DomainEvent<{ sku: string; fields: Record<string, unknown>; version: string }> {
  readonly type = 'product.master.snapshot';
  constructor(payload: { sku: string; fields: Record<string, unknown>; version: string }) {
    super(skuAggregateId(payload.sku, 'master'), payload, { snapshot: true });
  }
}
