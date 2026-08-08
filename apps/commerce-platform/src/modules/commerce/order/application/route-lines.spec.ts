import { routeLines } from './route-lines';

const products = new Map(Object.entries({
  p1: { id: 'p1', sku: 'A', fulfillmentMode: 'on_hand', leadTimeDays: null },
  p2: { id: 'p2', sku: 'B', fulfillmentMode: 'to_order', leadTimeDays: 3 },
  p3: { id: 'p3', sku: 'C', fulfillmentMode: 'both', leadTimeDays: null },
}));
const line = (id: string, productId: string) =>
  ({ id, orderId: 'o1', productId, qty: '2' });

describe('routeLines', () => {
  const today = new Date('2026-07-17T00:00:00Z');

  it('routes on_hand and both to the ERP path — both NEVER falls back', () => {
    const routed = routeLines([line('l1', 'p1'), line('l3', 'p3')], products as never, 7, today);
    expect(routed.map((r) => r.mode)).toEqual(['on_hand', 'on_hand']);
    expect(routed.every((r) => r.promisedDate === null)).toBe(true);
  });

  it('routes to_order with promised date = today + product lead time', () => {
    const [r] = routeLines([line('l2', 'p2')], products as never, 7, today);
    expect(r).toMatchObject({ mode: 'to_order', promisedDate: '2026-07-20' });
  });

  it('uses the default lead time when the product has none', () => {
    const p = new Map(products);
    p.set('p2', { ...p.get('p2')!, leadTimeDays: null });
    const [r] = routeLines([line('l2', 'p2')], p as never, 7, today);
    expect(r.promisedDate).toBe('2026-07-24');
  });

  it('throws for an unknown product', () => {
    expect(() => routeLines([line('l9', 'missing')], products as never, 7, today))
      .toThrow('missing');
  });
});
