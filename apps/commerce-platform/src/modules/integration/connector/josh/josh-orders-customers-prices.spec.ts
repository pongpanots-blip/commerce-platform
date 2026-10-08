import { BadRequestException } from '@nestjs/common';
import { JoshOrders, orderWhere, SYNC_STATES } from './josh-orders';
import { companyWhere, JoshCustomers } from './josh-customers';
import { isActiveDateRange, JoshPrices, resolvePromotionPrice, winningPrice, PriceLayers } from './josh-prices';

const LIKE_CASES: [string, string][] = [
  ['%%', '%\\%\\%%'], ['_', '%\\_%'], ['a%b', '%a\\%b%'], ['a\\b', '%a\\\\b%'], ['acme', '%acme%'],
];
const BRANCH = '11111111-1111-4111-8111-111111111111';

describe('josh orders (read-only)', () => {
  it('binds values, maps Jagota states to fixed SQL, rejects the rest', () => {
    const { where, params } = orderWhere({ search: "SO1'; drop", sync: 'failed', from: '2026-10-01' });
    expect(where).not.toContain('drop');
    expect(where).toContain(SYNC_STATES.failed);
    expect(params).toEqual(["%SO1'; drop%", new Date('2026-10-01')]);
    expect(() => orderWhere({ sync: 'x' })).toThrow(BadRequestException);
    expect(() => orderWhere({ companyId: '1 OR 1=1' })).toThrow(BadRequestException);
    expect(() => orderWhere({ to: 'soon' })).toThrow(BadRequestException);
  });

  it.each(LIKE_CASES)('search %s matches literally: bound as %s, every ILIKE has ESCAPE \'\\\'', (search, pattern) => {
    const { where, params } = orderWhere({ search });
    expect(params).toEqual([pattern]);
    expect(where.match(/ILIKE \$1 ESCAPE '\\'/g)).toHaveLength(4);
    expect(where.match(/ILIKE/g)).toHaveLength(4);
  });
});

describe('ORDERS_SOURCE=copies (stage 5, S5-7)', () => {
  const env = process.env.ORDERS_SOURCE;
  beforeEach(() => { process.env.ORDERS_SOURCE = 'copies'; });
  afterEach(() => { if (env === undefined) delete process.env.ORDERS_SOURCE; else process.env.ORDERS_SOURCE = env; });
  const make = () => {
    const replica = { configured: false, query: jest.fn() };
    const db = { query: jest.fn(async (sql: string): Promise<Record<string, unknown>[]> =>
      /count\(\*\)::int AS total FROM|AS total, /.test(sql) ? [{ total: 1 }]
        : /FROM josh_orders o LEFT JOIN josh_companies c ON c.id = o.company_id LEFT JOIN josh_users/.test(sql)
          ? [{ orders_id: 'o1', first_name: 'สมชาย', last_name: 'ใจดี', email: 'somchai@example.com', mobile_phone: '0898765432', branch_name: 'สาขา 1' }]
          : /FROM josh_order_shipments/.test(sql) ? [{ shipment_number: 'SH1', status: 'delivered' }]
            : /FROM josh_order_payments WHERE/.test(sql) ? [{ status: 'success', payment_method: 'qr', amount: 500 }] : []) };
    return { orders: new JoshOrders(replica as never, db as never), replica, db };
  };

  it('list / summary / detail work without the replica, on commerce tables only', async () => {
    const { orders, replica, db } = make();
    expect(orders.available).toBe(true);
    await orders.summary({ payment: 'missing', sync: 'failed' });
    const list = await orders.list({ search: 'x' });
    const d = await orders.detail('o1-number');
    expect(replica.query).not.toHaveBeenCalled();
    for (const [sql] of db.query.mock.calls) {
      expect(sql).not.toMatch(/payment_transactions|\bFROM orders\b|\bcompany c\b|\bbranch\b b|jagota_order_sync s|order_items|\busers u\b/);
    }
    expect(db.query.mock.calls[0][0]).toContain('NOT o.paid'); // payment=missing on the copy's paid flag
    expect(db.query.mock.calls[0][0]).toContain('FROM jagota_order_sync_history s');
    expect(list).toMatchObject({ source: 'copies', notCopied: ['items.order_taking_flag'] });
    const listSql = db.query.mock.calls.find(([sql]) => /ORDER BY o.create_date DESC/.test(sql))![0];
    expect(listSql).toContain('LEFT JOIN josh_branches b ON b.id = o.branch_id');
    expect(listSql).toContain('FROM josh_order_payments t WHERE t.orders_id = o.orders_id');
    // S5-11 copies: branch, ERP codes, sending date, shipments, payments, the orderer's phone (masked)
    expect(d).toMatchObject({ branch_name: 'สาขา 1', shipments: [{ shipment_number: 'SH1' }], payments: [{ payment_method: 'qr', amount: 500 }] });
    const detailSql = db.query.mock.calls.find(([sql]) => /LEFT JOIN josh_users/.test(sql))![0];
    expect(detailSql).toContain('o.sending_date::text AS sending_date');
    expect(detailSql).toContain('c.erp_customer_code, b.name AS branch_name, b.erp_branch_code');
    const by = (d as { orderedBy: { email: string; phone: string } }).orderedBy;
    expect(by.email).not.toBe('somchai@example.com'); // masked
    expect(by.phone).toBeTruthy();
    expect(by.phone).not.toBe('0898765432');
  });

  it('defaults to the replica', () => {
    delete process.env.ORDERS_SOURCE;
    expect(make().orders.available).toBe(false);
  });
});

describe('josh customers (read-only, masked)', () => {
  it('rejects unknown issues', () => {
    expect(() => companyWhere({ issue: 'all' })).toThrow(BadRequestException);
    expect(companyWhere({})).toEqual({ where: '', params: [] });
  });

  it.each(LIKE_CASES)('search %s matches literally: bound as %s, every ILIKE has ESCAPE \'\\\'', (search, pattern) => {
    const { where, params } = companyWhere({ search });
    expect(params).toEqual([pattern]);
    expect(where).toBe(`WHERE (c.name ILIKE $1 ESCAPE '\\' OR c.erp_customer_code ILIKE $1 ESCAPE '\\')`);
  });

  it('masks identity numbers, phones, emails and family names like josh winback', async () => {
    const q = jest.fn()
      .mockResolvedValueOnce([{ id: 'c1', name: 'ร้านดี', register_number: '0105556123456', phone: '0812345678' }])
      .mockResolvedValueOnce([{ id: 'b1', phone: '021234567', tax_id: '0105556123456' }])
      .mockResolvedValueOnce([{ id: 'u1', first_name: 'สมชาย', last_name: 'ใจดี', email: 'somchai@shop.co.th', mobile_phone: '0898765432', role: 'owner' }])
      .mockResolvedValue([{}]);
    const d = await new JoshCustomers({ query: q } as never).detail('11111111-1111-4111-8111-111111111111');
    const text = JSON.stringify(d);
    for (const raw of ['0105556123456', '0812345678', 'somchai@shop.co.th', '0898765432', 'ใจดี']) expect(text).not.toContain(raw);
    expect(d.users[0]).toMatchObject({ first_name: 'สมชาย', last_name: 'ใ.' });
  });
});

describe('josh prices (josh resolveSkuPrice order)', () => {
  const at = new Date('2026-10-05T03:00:00Z');
  const row = (price: number, start: string | null, end: string | null, id = String(price)) => ({ id, price, start_date: start, end_date: end });
  const layers = (over: Partial<PriceLayers>): PriceLayers => ({ base: 100, privatePrice: [], contract: [], branchSpecial: [], qtyRules: [], hasActiveMechanic: false, ...over });

  it('company private price beats branch contract beats branch special beats everything else', () => {
    expect(winningPrice(layers({ privatePrice: [row(80, null, null)], contract: [row(85, null, null)], branchSpecial: [row(90, null, null)] }), at)).toMatchObject({ source: 'customer_sku', price: 80 });
    expect(winningPrice(layers({ contract: [row(85, null, null)], branchSpecial: [row(90, null, null)] }), at)).toMatchObject({ source: 'contract_sku', price: 85 });
    expect(winningPrice(layers({ branchSpecial: [row(90, null, null)] }), at)).toMatchObject({ source: 'promotion', price: 90 });
  });

  it('skips rows outside their dates (UTC day, as josh), then promotion, qty tiers, base', () => {
    expect(winningPrice(layers({ privatePrice: [row(80, '2026-10-06', null)] }), at)).toMatchObject({ source: 'base', price: 100 });
    expect(winningPrice(layers({ privatePrice: [row(80, null, '2026-10-04')] }), at)).toMatchObject({ source: 'base' });
    expect(winningPrice(layers({ hasActiveMechanic: true }), at)).toEqual({ source: 'promotion_mechanic', price: null });
    expect(winningPrice(layers({ qtyRules: [{ min_qty: 1, max_qty: 9, promotion_price: 95 }] }), at)).toMatchObject({ source: 'promotion_mechanic', price: 95 });
    expect(isActiveDateRange('2026-10-05', '2026-10-05', at)).toBe(true);
  });

  it.each(LIKE_CASES)('branch and product search %s match literally: bound as %s, every ILIKE has ESCAPE \'\\\'', async (search, pattern) => {
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ branch_id: BRANCH, company_id: null }]).mockResolvedValue([]);
    const prices = new JoshPrices({ query } as never);
    await prices.branches(search);
    await prices.forBranch(BRANCH, search);
    const [[branchSql, branchParams], , [productSql, productParams]] = query.mock.calls;
    expect(branchParams).toEqual([pattern]);
    expect(branchSql.match(/ILIKE \$1 ESCAPE '\\'/g)).toHaveLength(3);
    expect(branchSql.match(/ILIKE/g)).toHaveLength(3);
    expect(productParams).toEqual([null, BRANCH, pattern]);
    expect(productSql.match(/ILIKE \$3 ESCAPE '\\'/g)).toHaveLength(2);
    expect(productSql.match(/ILIKE/g)).toHaveLength(2);
  });

  it('qty tiers: bounded ranges first, then the highest open-ended tier reached (josh resolvePromotionPrice)', () => {
    const rules = [{ min_qty: 1, max_qty: 4, promotion_price: 100 }, { min_qty: 10, max_qty: null, promotion_price: 80 }, { min_qty: 5, max_qty: null, promotion_price: 90 }];
    expect(resolvePromotionPrice(rules, 3, 120)).toBe(100);
    expect(resolvePromotionPrice(rules, 6, 120)).toBe(90);
    expect(resolvePromotionPrice(rules, 12, 120)).toBe(80);
    expect(resolvePromotionPrice([], 1, 120)).toBe(120);
  });
});
