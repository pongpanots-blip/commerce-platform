import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CustomerMetricsService, JOSH_ACTIVE_ORDER_STATUSES } from './customer-metrics.service';

/*
 * Stage 2a: metrics computed from commerce's copies (josh_orders + josh_customers). Opt-in, migrated scratch DB:
 *   CUSTOMERS_TEST_DATABASE_URL=postgres:///commerce_stage2_test npx jest -c apps/commerce-platform/jest.config.cts customer-metrics.service.db
 */
const url = process.env.CUSTOMERS_TEST_DATABASE_URL;
const A = '00000000-0000-4000-8000-00000000c0a1', B = '00000000-0000-4000-8000-00000000c0b2', GONE = '00000000-0000-4000-8000-00000000c0c3';
const ORDERS = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4'];

(url ? describe : describe.skip)('CustomerMetricsService against a database', () => {
  let db: DataSource;
  let svc: CustomerMetricsService;
  const clean = async () => {
    await db.query(`DELETE FROM josh_orders WHERE orders_id = ANY($1::uuid[])`, [ORDERS]);
    await db.query(`DELETE FROM customer_metrics WHERE user_id = ANY($1::uuid[])`, [[A, B, GONE]]);
    await db.query(`DELETE FROM josh_customers WHERE id = ANY($1::uuid[])`, [[A, B, GONE]]);
  };
  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url }).initialize();
    svc = new CustomerMetricsService(db);
    await clean();
    for (const id of [A, B, GONE]) await db.query(`INSERT INTO josh_customers (id, data) VALUES ($1, $2)`, [id, { id, created_at: '2026-01-01T00:00:00Z' }]);
    const order = (id: string, user: string, status: string, total: number, daysAgo: number) => db.query(
      `INSERT INTO josh_orders (orders_id, status, user_id, total_price, create_date) VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval)`,
      [id, status, user, total, daysAgo]);
    await order(ORDERS[0], A, 'delivered', 100, 120);
    await order(ORDERS[1], A, 'paid', 50, 5);
    await order(ORDERS[2], A, 'cancelled', 999, 1); // not an active status
    await order(ORDERS[3], GONE, 'paid', 10, 1);
    await db.query(`UPDATE josh_customers SET deleted_at = now(), data = '{}' WHERE id = $1`, [GONE]); // PDPA-deleted
  });
  afterAll(async () => { await clean(); await db?.destroy(); });

  it('aggregates active orders per customer, skips customers with no orders and deleted customers', async () => {
    // Scoped to this spec's customers: other DB specs may share the scratch database.
    const mine = (ids: string[]) => ids.filter((id) => [A, B, GONE].includes(id));
    const { changed } = await svc.recompute();
    expect(mine(changed)).toEqual([A]);
    const [a] = await db.query(`SELECT lifetime_order_count, lifetime_spend, avg_order_value, order_count_90d, spend_90d,
      first_order_at < now() - interval '100 days' AS first_is_old FROM customer_metrics WHERE user_id = $1`, [A]);
    expect(a).toEqual({ lifetime_order_count: 2, lifetime_spend: '150.00', avg_order_value: '75.00', order_count_90d: 1, spend_90d: '50.00', first_is_old: true });
    expect(await db.query(`SELECT user_id FROM customer_metrics WHERE user_id = ANY($1::uuid[])`, [[B, GONE]])).toEqual([]);
  });

  it('a second run changes nothing', async () => {
    expect((await svc.recompute()).changed.filter((id) => [A, B, GONE].includes(id))).toEqual([]);
  });

  it('push: shadow sends every row as a dry run; on sends unpushed rows then done, and marks them pushed', async () => {
    const post = jest.fn(async (body: { rows: unknown[]; dryRun?: boolean }) => (body.dryRun ? { different: 0 } : { written: body.rows.length }));
    svc.post = post as never;
    const shadow = await svc.push('shadow');
    expect(shadow.sent).toBeGreaterThanOrEqual(1);
    expect(post.mock.calls.every(([b]) => (b as { dryRun?: boolean }).dryRun === true)).toBe(true);
    expect((await db.query(`SELECT pushed_at FROM customer_metrics WHERE user_id = $1`, [A]))[0].pushed_at).toBeNull();

    post.mockClear();
    await svc.push('on');
    const bodies = post.mock.calls.map(([b]) => b as { rows: { user_id: string; first_order_at: unknown }[]; done?: boolean; statuses: string[] });
    expect(bodies.at(-1)).toMatchObject({ done: true, rows: [], statuses: JOSH_ACTIVE_ORDER_STATUSES });
    const rowA = bodies.flatMap((b) => b.rows).find((r) => r.user_id === A)!;
    expect(typeof rowA.first_order_at).toBe('string'); // ::text, so josh compares microseconds exactly
    expect((await db.query(`SELECT pushed_at IS NOT NULL AS pushed FROM customer_metrics WHERE user_id = $1`, [A]))[0].pushed).toBe(true);

    post.mockClear();
    await svc.push('on'); // nothing changed since: only the final done
    const resent = post.mock.calls.flatMap(([b]) => (b as { rows: { user_id: string }[] }).rows).map((r) => r.user_id);
    expect(resent).not.toContain(A);
  });
});
