import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';
import { PromotionRule } from './promotion-rules';
export class ProductPromotionRulesSnapshot extends DomainEvent<{ sku: string; rules: PromotionRule[]; version: string; rules_reset_version: string }> {
  readonly type = 'product.promotion-rules.snapshot';
  constructor(payload: { sku: string; rules: PromotionRule[]; version: string; rules_reset_version: string }) { super(skuAggregateId(payload.sku, 'promotion-rules'), payload, { snapshot: true }); }
}
