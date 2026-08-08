import { Product } from '../../product/infrastructure/product.entity';
import { OrderLine } from '../infrastructure/order-line.entity';
import { ReserveRequestLine } from '../../reservation/application/reservation.facade';

/**
 * Fulfillment routing (brief §5): on_hand and both → ERP hold; to_order →
 * demand with promised date. 'both' never falls back to to_order (§9 ruling).
 */
export function routeLines(
  lines: Pick<OrderLine, 'id' | 'orderId' | 'productId' | 'qty'>[],
  products: Map<string, Pick<Product, 'id' | 'sku' | 'fulfillmentMode' | 'leadTimeDays'>>,
  defaultLeadTimeDays: number,
  today: Date,
): ReserveRequestLine[] {
  return lines.map((line) => {
    const product = products.get(line.productId);
    if (!product) throw new Error(`product ${line.productId} not found for order line ${line.id}`);

    const toOrder = product.fulfillmentMode === 'to_order';
    let promisedDate: string | null = null;
    if (toOrder) {
      const lead = product.leadTimeDays ?? defaultLeadTimeDays;
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + lead);
      promisedDate = d.toISOString().slice(0, 10);
    }
    return {
      orderId: line.orderId,
      orderLineId: line.id,
      productId: product.id,
      sku: product.sku,
      qty: Number(line.qty),
      mode: toOrder ? 'to_order' : 'on_hand',
      promisedDate,
    };
  });
}
