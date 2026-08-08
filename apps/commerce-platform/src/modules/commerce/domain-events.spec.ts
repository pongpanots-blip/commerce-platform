import { CustomerCreated } from './customer/domain/events/customer-created.event';
import { CustomerUpdated } from './customer/domain/events/customer-updated.event';
import { ProductUpdated } from './product/domain/events/product-updated.event';
import { OrderCreated } from './order/domain/events/order-created.event';
import { OrderConfirmed } from './order/domain/events/order-confirmed.event';
import { OrderCancelled } from './order/domain/events/order-cancelled.event';
import { InventoryUpdated } from './inventory/domain/events/inventory-updated.event';
import { PriceUpdated } from './price-list/domain/events/price-updated.event';
import { SupplierUpdated } from './supplier/domain/events/supplier-updated.event';

describe('canonical domain events', () => {
  const cases: [
    new (id: string, payload: { id: string }) => { type: string; aggregateId: string },
    string,
  ][] = [
    [CustomerCreated, 'customer.created'],
    [CustomerUpdated, 'customer.updated'],
    [ProductUpdated, 'product.updated'],
    [OrderCreated, 'order.created'],
    [OrderConfirmed, 'order.confirmed'],
    [OrderCancelled, 'order.cancelled'],
    [InventoryUpdated, 'inventory.updated'],
    [PriceUpdated, 'price.updated'],
    [SupplierUpdated, 'supplier.updated'],
  ];

  it.each(cases)('%p exposes the expected type string', (Ctor, expected) => {
    const event = new Ctor('agg-1', { id: 'agg-1' });
    expect(event.type).toBe(expected);
    expect(event.aggregateId).toBe('agg-1');
  });
});
