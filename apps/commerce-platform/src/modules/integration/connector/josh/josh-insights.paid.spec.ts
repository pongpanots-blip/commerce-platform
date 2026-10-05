import { JoshInsights, paidOrderSql } from './josh-insights';

describe('sales count only paid orders', () => {
  it('paid = a successful, non-test payment linked directly or through payment_transaction_orders', () => {
    const sql = paidOrderSql('o');
    expect(sql).toContain("pt_.order_id = o.orders_id AND pt_.status::text = 'success' AND NOT pt_.is_test");
    expect(sql).toContain('payment_transaction_orders pl_');
    expect(sql).toContain("pl_.order_id = o.orders_id AND pt_.status::text = 'success' AND NOT pt_.is_test");
  });

  it('every sales total, daily bucket and top product requires it (a delivered order whose payment was cancelled is not sales)', async () => {
    const seen: string[] = [];
    const replica = { configured: true, query: jest.fn(async (sql: string) => { seen.push(sql); return [{}]; }) };
    const range = { label: 'x', from: new Date('2026-09-01'), to: new Date('2026-10-01') };
    await new JoshInsights(replica as never).sales({ current: range, previous: range }).catch(() => undefined);
    const salesSql = seen.filter((s) => /FROM orders o/.test(s));
    expect(salesSql.length).toBeGreaterThanOrEqual(3);
    for (const s of salesSql) expect(s).toContain('payment_transaction_orders');
  });
});
