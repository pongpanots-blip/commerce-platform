import { PackInputsService } from './pack-inputs.service';
import { CompetitorPricesService, catalogFingerprint } from '../competitor-prices/competitor-prices.service';
import { toInventoryShape } from '../competitor-prices/catalog-shape';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { fixtureScenario } from './pack-fixtures';

describe('pack input reuse of recorded catalog and competitor evidence', () => {
  const product = { id: '00000000-0000-4000-8000-000000000001', sku: 'SYNTHETIC-SKU', status: 'active', sellingUnit: 'PK', packSize: '1 KG', packagingType: 'fixed', vatType: '7%', orderingPrice: '107.00', translations: [], brandName: null, weightPerUnit: '1 KG', joshUpdatedAt: new Date('2026-10-09T11:00:00Z'), syncedAt: new Date('2026-10-09T11:00:00Z') } as unknown as JoshCatalogProduct;
  let pairs: Record<string, unknown>[], products: { find: jest.Mock; findOneBy: jest.Mock }, sync: { configured: boolean; syncSku: jest.Mock }, service: PackInputsService;
  beforeEach(() => {
    products = { find: jest.fn(async () => [product]), findOneBy: jest.fn() }; sync = { configured: true, syncSku: jest.fn() };
    pairs = [{ id: '00000000-0000-4000-8000-000000000002', revision: 1, product, ourWeightKg: '1', competitorWeightKg: '1', competitorUnit: 'kg', competitorQtyMin: null, competitorQtyMax: null, competitorPackCount: 1, sourceUrl: 'https://www.bigc.co.th/synthetic-product', competitorName: 'Synthetic pack', sourceContext: 'Synthetic baht inclusive price', priceIncVat: '100.10', observedAt: new Date(), captureMethod: 'manual', vatIncluded: true, verifiedFingerprint: catalogFingerprint(toInventoryShape(product)), scrapingSource: null }];
    const competitors = new CompetitorPricesService({ find: async () => pairs } as never, products as never, sync as never, {} as never); service = new PackInputsService(competitors);
  });
  it('reads an active unambiguous local copy and original decimals without sync, scraping, manual captures or cost inference', async () => {
    const inputs = await service.inputs(product.sku); expect(inputs).toMatchObject({ sku: product.sku, cost: null, product: { currentPriceIncVat: '107.00', basis: { unit: 'kg', quantity: '1', count: 1 } } });
    expect(inputs.observations[0]).toMatchObject({ priceIncVat: '100.10', currency: 'THB', mapped: true, originalPack: { unit: 'kg', min: '1', max: '1', count: 1 } }); expect(sync.syncSku).not.toHaveBeenCalled(); expect(products.findOneBy).not.toHaveBeenCalled();
  });
  it('rejects missing or ambiguous own products instead of pulling/writing a catalog copy', async () => {
    products.find.mockResolvedValueOnce([]); await expect(service.inputs(product.sku)).rejects.toThrow('not found'); products.find.mockResolvedValueOnce([product, product]); await expect(service.inputs(product.sku)).rejects.toThrow('ambiguous'); expect(sync.syncSku).not.toHaveBeenCalled();
  });
  it('fingerprints changing prices/revisions and rejects stale source edits before preview', async () => {
    const original = await service.inputs(product.sku), scenario = fixtureScenario(original); pairs[0].priceIncVat = '100.20'; pairs[0].revision = 2;
    await expect(service.preview(scenario)).rejects.toThrow('evidence changed'); expect((await service.inputs(product.sku)).sourceFingerprint).not.toBe(original.sourceFingerprint);
  });
  it('invalidates old preview identity when evidence crosses the existing freshness boundary, without hashing every read time', async () => {
    const time = new Date('2026-10-09T11:00:00Z'); pairs[0].observedAt = time;
    const a = await service.inputs(product.sku, () => new Date('2026-10-09T12:00:00Z')), b = await service.inputs(product.sku, () => new Date('2026-10-09T13:00:00Z')), expired = await service.inputs(product.sku, () => new Date('2026-10-10T11:00:00.001Z'));
    expect(a.sourceFingerprint).toBe(b.sourceFingerprint); expect(expired.sourceFingerprint).not.toBe(a.sourceFingerprint);
  });
});
