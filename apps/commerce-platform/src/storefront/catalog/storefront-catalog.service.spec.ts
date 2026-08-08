import { StorefrontCatalogService } from './storefront-catalog.service';

function makeService(products: unknown[], levels: unknown[] = [], priceItems: unknown[] = []) {
  const repoFor = (rows: unknown[]) => ({
    findAndCount: jest.fn().mockResolvedValue([rows, rows.length]),
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockResolvedValue(rows[0] ?? null),
  });
  const repos: Record<string, unknown> = {
    Product: repoFor(products), InventoryLevel: repoFor(levels), PriceListItem: repoFor(priceItems),
  };
  const dataSource = { getRepository: (e: { name: string }) => repos[e.name] };
  return new StorefrontCatalogService(dataSource as never);
}

describe('StorefrontCatalogService', () => {
  const product = { id: 'p1', sku: 'A', name: 'Fish', description: null, status: 'active',
    fulfillmentMode: 'both', leadTimeDays: 3 };

  it('list merges stock (quantity - reserved, floored at 0) and latest price', async () => {
    const svc = makeService(
      [product],
      [{ productId: 'p1', quantity: '10', reserved: '4' }],
      [{ productId: 'p1', unitPrice: '99.5000', createdAt: new Date() }],
    );
    const page = await svc.list({ page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({ id: 'p1', sku: 'A', fulfillmentMode: 'both',
      leadTimeDays: 3, stock: 6, price: '99.50' });
    expect(page.total).toBe(1);
  });

  it('product with no inventory rows and no price → stock 0, price null', async () => {
    const svc = makeService([product]);
    const page = await svc.list({ page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({ stock: 0, price: null });
  });

  it('byId throws NotFound for a missing product', async () => {
    const svc = makeService([]);
    await expect(svc.byId('missing')).rejects.toThrow('not found');
  });
});
