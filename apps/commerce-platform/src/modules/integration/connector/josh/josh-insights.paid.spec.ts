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
    await new JoshInsights(replica as never, {} as never).sales({ current: range, previous: range }).catch(() => undefined);
    const salesSql = seen.filter((s) => /FROM orders o/.test(s));
    expect(salesSql.length).toBeGreaterThanOrEqual(3);
    for (const s of salesSql) expect(s).toContain('payment_transaction_orders');
  });
});

describe('SALES_SOURCE=copies (stage 5, S5-5)', () => {
  const env = process.env.SALES_SOURCE;
  afterEach(() => { if (env === undefined) delete process.env.SALES_SOURCE; else process.env.SALES_SOURCE = env; });
  const range = { label: 'x', from: new Date('2026-09-01'), to: new Date('2026-10-01') };
  const totals = { orders: 2, revenue_inc_vat: 300, subtotal_ex_vat: 280, discounts_inc_vat: 0, buying_customers: 1, buying_companies: 1,
    awaiting_payment: 0, cancelled: 0, refunded: 0, settled_without_payment: 0, settled_without_payment_value: 0 };
  const fake = (rows: Record<string, unknown>) => ({
    configured: false,
    query: jest.fn(async (sql: string) => (/AS orders,/.test(sql) && /count\(\*\) FILTER/.test(sql) ? [rows] : /customer_metrics/.test(sql) ? [{ n: 1 }]
      : /order_refunds/.test(sql) ? [{ n: 1, amount: 50 }] : /GROUP BY 1, 2/.test(sql) ? [{ sku: 'A' }, { sku: 'B' }] : [])),
  });

  it('defaults to the replica; copies answer from commerce tables only, without the replica', async () => {
    delete process.env.SALES_SOURCE;
    const replica = fake(totals), db = fake(totals);
    const insights = new JoshInsights(replica as never, db as never);
    expect(insights.salesAvailable).toBe(false);
    process.env.SALES_SOURCE = 'copies';
    expect(insights.salesAvailable).toBe(true);
    const out = await insights.sales({ current: range, previous: range });
    expect(replica.query).not.toHaveBeenCalled();
    expect(out.source).toBe('copies');
    expect(out.totals.orders).toBe(2);
    expect(out.totals.refunds).toEqual({ n: 1, amount: 50 }); // S5-11 refunds copy
    for (const [sql] of db.query.mock.calls) {
      expect(sql).not.toMatch(/payment_transaction|\bFROM orders\b|order_items|product_inventory\b|\border_refunds/);
    }
    const refundSql = db.query.mock.calls.map(([sql]) => sql).find((sql) => /josh_order_refunds/.test(sql));
    expect(refundSql).toContain("status::text = 'refunded' AND created_at >= $1 AND created_at < $2");
    const sold = db.query.mock.calls.map(([sql]) => sql).filter((sql) => /josh_orders o/.test(sql));
    expect(sold).toHaveLength(4); // totals ×2, daily, top products
    for (const sql of sold) expect(sql).toContain('o.status = ANY($3) AND o.paid');
    expect(sold[0]).toContain('NOT o.paid'); // settled_without_payment
  });

  it('parity lists the totals that differ and the top-products ranking diff', async () => {
    const insights = new JoshInsights(fake(totals) as never, fake({ ...totals, orders: 3 }) as never);
    const p = await insights.salesParity({ current: range, previous: range });
    expect(p.differs).toEqual([{ field: 'orders', replica: 2, copies: 3 }, { field: 'average_order_inc_vat', replica: 150, copies: 100 }]);
    expect(p.topProducts.firstDiffRank).toBeNull();
    expect(p.replica.source).toBe('replica');
    expect(p.copies.source).toBe('copies');
  });
});
