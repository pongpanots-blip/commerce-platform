import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';
import type { OrderPeriodRow } from './order-periods';

export type SupplierOrderPeriodsPayload = {
  supCode: string;
  /** Every round commerce has for the supplier, open and closed — josh replaces its rows with these. */
  periods: Array<Omit<OrderPeriodRow, 'sup_code'>>;
  version: string;
};

/** `supplier.order_periods.snapshot` (stage 4f): one supplier's order rounds. Latest wins. */
export class SupplierOrderPeriodsSnapshot extends DomainEvent<SupplierOrderPeriodsPayload> {
  readonly type = 'supplier.order_periods.snapshot';
  constructor(payload: SupplierOrderPeriodsPayload) {
    super(skuAggregateId(payload.supCode, 'order-periods'), payload, { snapshot: true });
  }
}

/** `product.logistics.snapshot` (stage 4f): every logistics key commerce holds for one SKU (logistics-fields.ts). Latest wins. */
export class ProductLogisticsSnapshot extends DomainEvent<{ sku: string; fields: Record<string, unknown>; version: string }> {
  readonly type = 'product.logistics.snapshot';
  constructor(payload: { sku: string; fields: Record<string, unknown>; version: string }) {
    super(skuAggregateId(payload.sku, 'logistics'), payload, { snapshot: true });
  }
}
