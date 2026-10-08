import { BadRequestException } from '@nestjs/common';
import { JoshProducts, PRODUCT_ISSUES, productWhere } from './josh-products';

const LIKE_CASES: [string, string][] = [
  ['%%', '%\\%\\%%'], ['_', '%\\_%'], ['a%b', '%a\\%b%'], ['a\\b', '%a\\\\b%'], ['acme', '%acme%'],
];

describe('josh products (read-only catalog)', () => {
  it('binds typed values as parameters and maps issues to fixed SQL', () => {
    const { where, params } = productWhere({ search: "x'; drop", issue: 'no_image', brand: 'Josh', orderTaking: 'Y' });
    expect(where).not.toContain('drop');
    expect(params).toEqual(["%x'; drop%", '%Josh%', 'Y']);
    expect(where).toContain(PRODUCT_ISSUES.no_image);
    expect(productWhere({})).toEqual({ where: '', params: [] });
  });

  it.each(LIKE_CASES)('search / brand %s match literally: bound as %s, every ILIKE has ESCAPE \'\\\'', (search, pattern) => {
    for (const d of [productWhere({ search, brand: search }), productWhere({ search, brand: search }, { nameTh: 'p.name_th', nameEn: 'p.name_en', issues: PRODUCT_ISSUES })]) {
      expect(d.params).toEqual([pattern, pattern]);
      expect(d.where.match(/ILIKE \$\d+ ESCAPE '\\'/g)).toHaveLength(4);
      expect(d.where.match(/ILIKE/g)).toHaveLength(4);
    }
  });

  it('rejects unknown issues and non-uuid categories', () => {
    expect(() => productWhere({ issue: '1=1' })).toThrow(BadRequestException);
    expect(() => productWhere({ categoryId: 'x' })).toThrow(BadRequestException);
  });

  it('shows each pending ERP field next to the live value', async () => {
    const replica = { query: jest.fn()
      .mockResolvedValueOnce([{ product_inventory_id: 'p1', selling_unit_price: 250, name_th: 'แซลมอน',
        erp_pending_payload: { SELLING_UNIT_PRICE: 275, PRODUCT_NAME_T: 'แซลมอน', SOMETHING_NEW: 1 } }])
      .mockResolvedValueOnce([]) };
    const d = await new JoshProducts(replica as never, {} as never).detail('1001876');
    expect(replica.query.mock.calls[0][0]).toContain('p.product_inventory_sku = $1');
    expect(d.pendingChanges).toEqual([
      { field: 'SELLING_UNIT_PRICE', column: 'selling_unit_price', current: 250, pending: 275, changed: true },
      { field: 'PRODUCT_NAME_T', column: 'name_th', current: 'แซลมอน', pending: 'แซลมอน', changed: false },
      { field: 'SOMETHING_NEW', column: null, current: null, pending: 1, changed: null },
    ]);
  });
});

describe('PRODUCTS_SOURCE=copies (stage 5, S5-4)', () => {
  const keys = ['PRODUCTS_SOURCE', 'COMMERCE_OWNS_PRICES', 'COMMERCE_OWNS_PRODUCT_MASTER', 'COMMERCE_OWNS_PRODUCT_IMAGES', 'COMMERCE_OWNS_PRODUCT_CONTENT', 'COMMERCE_OWNS_CATEGORIES'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  beforeEach(() => { for (const k of keys) delete process.env[k]; process.env.PRODUCTS_SOURCE = 'copies'; });
  afterAll(() => { for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  const make = (rows: unknown[][] = []) => {
    const replica = { configured: false, query: jest.fn() };
    const db = { query: jest.fn(async () => [] as unknown[]) };
    rows.forEach((r) => db.query.mockResolvedValueOnce(r));
    return { replica, db, products: new JoshProducts(replica as never, db as never) };
  };

  it('summary / list read the catalog copy (removed products out), never the replica; no_image uses the copied count', async () => {
    const { replica, db, products } = make([[{ total: 2, missing_report_fields: 0 }], [], [], [{ total: 0 }]]);
    expect(products.available).toBe(true);
    expect(await products.summary()).toMatchObject({ total: 2, missing_report_fields: 0 });
    await products.list({ issue: 'no_image', search: 'แซลมอน' });
    expect(replica.query).not.toHaveBeenCalled();
    const sqls = db.query.mock.calls.map((c) => (c as unknown as [string])[0]);
    for (const sql of sqls) expect(sql).toContain('FROM josh_catalog_products c');
    for (const sql of sqls) expect(sql).toContain('WHERE c.removed_at IS NULL');
    expect(sqls[0]).toContain('count(*) FILTER (WHERE p.image_count IS NULL)::int AS missing_report_fields');
    expect(sqls[2]).toContain('p.image_count = 0');
    expect(sqls[2]).toContain('p.name_th ILIKE');
    expect(sqls[2]).not.toContain('product_media');
    expect(sqls[0]).not.toContain('product_prices');
  });

  it('owned prices / ERP queues / galleries overlay the copy', async () => {
    process.env.COMMERCE_OWNS_PRICES = 'true';
    process.env.COMMERCE_OWNS_PRODUCT_MASTER = 'true';
    process.env.COMMERCE_OWNS_PRODUCT_IMAGES = 'true';
    const { db, products } = make([[{ total: 0 }], []]);
    await products.summary();
    const sql = (db.query.mock.calls[0] as unknown as [string])[0];
    expect(sql).toContain('COALESCE(pr.selling_unit_price, c.selling_unit_price)');
    expect(sql).toContain('COALESCE(c.erp_pending_at, GREATEST(pp.received_at, pm.received_at))');
    expect(sql).toContain('COALESCE(jsonb_array_length(pi.images), c.image_count)');
  });

  it('detail: commerce queues as pendingChanges, gallery as media, content fields; what is not copied is listed', async () => {
    process.env.COMMERCE_OWNS_PRICES = 'true';
    process.env.COMMERCE_OWNS_PRODUCT_IMAGES = 'true';
    const { db, products } = make([
      [{ product_inventory_id: 'p1', product_inventory_sku: '1001', selling_unit_price: 250, moq: 1, image_url: 'a.jpg' }],
      [{ images: ['a.jpg', 'b.jpg'] }],
      [{ selling_unit_price: 275, ordering_price: null, moq: 1 }],
    ]);
    const d = await products.detail('1001') as Record<string, unknown>;
    expect(d.pendingChanges).toEqual([
      { field: 'selling_unit_price', column: 'selling_unit_price', current: 250, pending: 275, changed: true },
      { field: 'moq', column: 'moq', current: 1, pending: 1, changed: false },
    ]);
    expect(d.media).toEqual([{ id: null, source: 'a.jpg', media_type: 'image', sort_order: 0 }, { id: null, source: 'b.jpg', media_type: 'image', sort_order: 1 }]);
    expect(d.ingredients).toBeNull();
    expect(d.notCopied).toEqual(['content fields (ingredients … reorder_quantity)']);
  });

  it('categories: the copied products\' categories, or commerce\'s tree when it owns categories', async () => {
    const { db, products } = make();
    await products.categories();
    process.env.COMMERCE_OWNS_CATEGORIES = 'true';
    await products.categories();
    const sqls = db.query.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(sqls[0]).toContain('FROM josh_catalog_products');
    expect(sqls[1]).toContain('FROM product_categories');
  });
});
