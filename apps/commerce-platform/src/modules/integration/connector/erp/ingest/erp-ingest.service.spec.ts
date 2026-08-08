import { ErpIngestService } from './erp-ingest.service';

/**
 * Mock repos keyed by entity class name, matching the DataSource.getRepository
 * mock style used across the ERP connector specs (see
 * erp-order-push.subscriber.spec.ts).
 */
function makeRepoStub(initial: Record<string, unknown> | null = null, idPrefix = 'x') {
  let seq = 0;
  const store = initial ? { id: `${idPrefix}0`, ...initial } : null;
  return {
    __store: store,
    findOne: jest.fn().mockImplementation(async () => store),
    save: jest.fn().mockImplementation(async (r: Record<string, unknown>) => ({
      id: (r.id as string) ?? `${idPrefix}${++seq}`,
      ...r,
    })),
    create: (r: Record<string, unknown>) => ({ ...r }),
  };
}

function makeService(opts: {
  productRepo?: unknown;
  warehouseRepo?: unknown;
  inventoryRepo?: unknown;
  customerRepo?: unknown;
  priceListRepo?: unknown;
  priceListItemRepo?: unknown;
  autoApply?: string[] | null;
  toPlatformId?: jest.Mock;
} = {}) {
  const ingestRows = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const ingestRepo = {
    save: jest.fn().mockImplementation(async (r: Record<string, unknown>) => {
      const row = { id: (r.id as string) ?? `rec${++seq}`, ...r };
      ingestRows.set(row.id, row);
      return row;
    }),
    create: (r: Record<string, unknown>) => ({ ...r }),
    findOne: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
      ingestRows.get(where.id) ?? null),
  };

  const defaultRepos: Record<string, unknown> = {
    Product: opts.productRepo ?? makeRepoStub(null, 'p'),
    Warehouse: opts.warehouseRepo ?? makeRepoStub(null, 'w'),
    InventoryLevel: opts.inventoryRepo ?? makeRepoStub(null, 'il'),
    Customer: opts.customerRepo ?? makeRepoStub(null, 'c'),
    PriceList: opts.priceListRepo ?? makeRepoStub({ name: 'ERP Base', currency: 'THB', status: 'active' }, 'pl'),
    PriceListItem: opts.priceListItemRepo ?? makeRepoStub(null, 'pli'),
  };
  const dataSource = { getRepository: (entity: { name: string }) => defaultRepos[entity.name] };

  const settings = { get: jest.fn().mockResolvedValue(opts.autoApply === undefined ? null : opts.autoApply) };
  const mapping = {
    link: jest.fn().mockResolvedValue(undefined),
    toPlatformId: opts.toPlatformId ?? jest.fn().mockResolvedValue(null),
  };

  const service = new ErpIngestService(ingestRepo as never, dataSource as never, settings as never, mapping as never);
  return { service, ingestRepo, defaultRepos, settings, mapping, ingestRows };
}

const productRaw = {
  INVENTORY_ITEM_ID: 10001, SEGMENT1: 'FISH-SALMON-1KG', DESCRIPTION: 'Salmon Fillet 1kg',
  PRIMARY_UOM_CODE: 'KG', INVENTORY_ITEM_STATUS_CODE: 'Active', FULL_LEAD_TIME: 3, LIST_PRICE: 590.0,
};

const stockRaw = {
  INVENTORY_ITEM_ID: 10001, SEGMENT1: 'FISH-SALMON-1KG', SUBINVENTORY_CODE: 'BKK-MAIN', ON_HAND_QTY: 42,
};

const customerRaw = {
  CUST_ACCOUNT_ID: 5001, ACCOUNT_NUMBER: 'JGT-00871', PARTY_NAME: 'Somchai Restaurant Co., Ltd.',
  EMAIL_ADDRESS: 'ap@somchai.co.th', PHONE_NUMBER: '021234567', TAX_REFERENCE: '0105561234567',
};

const saleOrderRaw = {
  HEADER_ID: 7001, ORDER_NUMBER: 'SO-2026-045121', ORDERED_DATE: '2026-07-18T09:30:00Z',
  SOLD_TO_ACCOUNT: 'JGT-00871',
  LINES: [{ LINE_NUMBER: 1, SEGMENT1: 'FISH-SALMON-1KG', ORDERED_QUANTITY: 10, UNIT_SELLING_PRICE: 550.0 }],
};

describe('ErpIngestService.stage', () => {
  it('stages a parsed product row as received', async () => {
    const { service, ingestRepo } = makeService();
    await service.stage('i1', 'product', productRaw);
    const saved = (ingestRepo.save as jest.Mock).mock.calls[0][0];
    expect(saved).toMatchObject({ integrationId: 'i1', entityType: 'product', externalId: '10001', status: 'received' });
    expect(saved.parsedPayload.sku).toBe('FISH-SALMON-1KG');
  });

  it('parse failure → failed row with error, raw preserved, NO throw', async () => {
    const { service, ingestRepo } = makeService();
    await expect(service.stage('i1', 'product', { garbage: true })).resolves.toBeDefined();
    const saved = (ingestRepo.save as jest.Mock).mock.calls[0][0];
    expect(saved).toMatchObject({ status: 'failed' });
    expect(saved.error).toContain('SEGMENT1');
  });
});

describe('ErpIngestService.apply — product', () => {
  it('product/new: creates Product + PriceListItem (listPrice present) + links mapping → applied', async () => {
    const { service, defaultRepos, mapping } = makeService();
    const record = await service.stage('i1', 'product', productRaw);

    const applied = await service.apply(record.id);

    expect((defaultRepos.Product as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'FISH-SALMON-1KG', name: 'Salmon Fillet 1kg', status: 'active', leadTimeDays: 3 }),
    );
    expect((defaultRepos.PriceListItem as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: '590.00' }),
    );
    expect(mapping.link).toHaveBeenCalledWith('i1', 'product', expect.any(String), '10001');
    expect(applied.status).toBe('applied');
    expect(applied.appliedAt).toBeInstanceOf(Date);
  });

  it('product/existing (resolved via mapping): updates status/leadTimeDays ONLY — name NOT overwritten', async () => {
    const existingProduct = { id: 'p-existing', sku: 'FISH-SALMON-1KG', name: 'Merchandising Copy (keep me)', status: 'inactive', leadTimeDays: 99 };
    const productRepo = makeRepoStub(existingProduct, 'p');
    const toPlatformId = jest.fn().mockResolvedValue('p-existing');
    const { service, defaultRepos, mapping } = makeService({ productRepo, toPlatformId });

    const record = await service.stage('i1', 'product', productRaw);
    await service.apply(record.id);

    expect((defaultRepos.Product as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Merchandising Copy (keep me)', status: 'active', leadTimeDays: 3 }),
    );
    expect(mapping.link).toHaveBeenCalledWith('i1', 'product', 'p-existing', '10001');
  });

  it('product/existing resolved by sku fallback when no mapping row exists', async () => {
    const existingProduct = { id: 'p-sku-match', sku: 'FISH-SALMON-1KG', name: 'Kept Name', status: 'inactive', leadTimeDays: null };
    const productRepo = makeRepoStub(existingProduct, 'p');
    const { service, defaultRepos } = makeService({ productRepo });

    const record = await service.stage('i1', 'product', productRaw);
    await service.apply(record.id);

    expect((defaultRepos.Product as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Kept Name', status: 'active', leadTimeDays: 3 }),
    );
  });

  it('re-apply with an UNCHANGED listPrice does NOT append another PriceListItem row', async () => {
    const existingProduct = { id: 'p1', sku: 'FISH-SALMON-1KG', name: 'X', status: 'active', leadTimeDays: 3 };
    const productRepo = makeRepoStub(existingProduct, 'p');
    // latest row for (priceListId, productId, minQty=1) already carries 590.00 (stored at numeric scale 4)
    const priceListItemRepo = makeRepoStub({ priceListId: 'pl0', productId: 'p1', minQty: '1', unitPrice: '590.0000' }, 'pli');
    const { service, defaultRepos } = makeService({ productRepo, priceListItemRepo });

    const record = await service.stage('i1', 'product', productRaw);
    const applied = await service.apply(record.id);

    expect((defaultRepos.PriceListItem as { save: jest.Mock }).save).not.toHaveBeenCalled();
    expect(applied.status).toBe('applied');
  });

  it('a CHANGED listPrice appends a new PriceListItem row (append-only price history)', async () => {
    const existingProduct = { id: 'p1', sku: 'FISH-SALMON-1KG', name: 'X', status: 'active', leadTimeDays: 3 };
    const productRepo = makeRepoStub(existingProduct, 'p');
    const priceListItemRepo = makeRepoStub({ priceListId: 'pl0', productId: 'p1', minQty: '1', unitPrice: '500.0000' }, 'pli');
    const { service, defaultRepos } = makeService({ productRepo, priceListItemRepo });

    const record = await service.stage('i1', 'product', productRaw);
    await service.apply(record.id);

    expect((defaultRepos.PriceListItem as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', unitPrice: '590.00' }),
    );
  });

  it('creates the "ERP Base" price list when none exists yet', async () => {
    const priceListRepo = makeRepoStub(null, 'pl'); // findOne → null → CREATE branch
    const { service, defaultRepos } = makeService({ priceListRepo });

    const record = await service.stage('i1', 'product', productRaw);
    await service.apply(record.id);

    expect((defaultRepos.PriceList as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ERP Base', currency: 'THB', status: 'active' }),
    );
    expect((defaultRepos.PriceListItem as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: '590.00' }),
    );
  });
});

describe('ErpIngestService.apply — stock', () => {
  it('stock happy path: resolves product, auto-creates warehouse, upserts InventoryLevel.quantity', async () => {
    const existingProduct = { id: 'p1', sku: 'FISH-SALMON-1KG' };
    const productRepo = makeRepoStub(existingProduct, 'p');
    const { service, defaultRepos } = makeService({ productRepo });

    const record = await service.stage('i1', 'stock', stockRaw);
    const applied = await service.apply(record.id);

    expect((defaultRepos.Warehouse as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BKK-MAIN', name: 'BKK-MAIN' }),
    );
    expect((defaultRepos.InventoryLevel as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', quantity: '42' }),
    );
    expect(applied.status).toBe('applied');
  });

  it('stock unknown product → failed with error "unknown product"', async () => {
    const productRepo = makeRepoStub(null, 'p'); // findOne always resolves null
    const { service } = makeService({ productRepo });

    const record = await service.stage('i1', 'stock', stockRaw);
    const applied = await service.apply(record.id);

    expect(applied.status).toBe('failed');
    expect(applied.error).toBe('unknown product');
  });
});

describe('ErpIngestService.apply — customer', () => {
  it('customer/new: creates + links mapping → applied', async () => {
    const { service, defaultRepos, mapping } = makeService();
    const record = await service.stage('i1', 'customer', customerRaw);

    const applied = await service.apply(record.id);

    expect((defaultRepos.Customer as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'JGT-00871', name: 'Somchai Restaurant Co., Ltd.', email: 'ap@somchai.co.th', phone: '021234567' }),
    );
    expect(mapping.link).toHaveBeenCalledWith('i1', 'customer', expect.any(String), '5001');
    expect(applied.status).toBe('applied');
  });

  it('customer/existing: updates name/code, fills email/phone only when missing (ERP owns code)', async () => {
    const existingCustomer = { id: 'c-existing', code: 'JGT-00871', name: 'Old Party Name', email: null, phone: 'already-set' };
    const customerRepo = makeRepoStub(existingCustomer, 'c');
    const { service, defaultRepos } = makeService({ customerRepo });

    const record = await service.stage('i1', 'customer', customerRaw);
    await service.apply(record.id);

    expect((defaultRepos.Customer as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Somchai Restaurant Co., Ltd.', code: 'JGT-00871',
        email: 'ap@somchai.co.th', // was null → filled
        phone: 'already-set', // was set → NOT overwritten by ERP phone
      }),
    );
  });
});

describe('ErpIngestService.apply — sale_order (store-only deviation)', () => {
  it('sale_order → skipped, NO platform writes, NO mapping call', async () => {
    const { service, defaultRepos, mapping } = makeService();
    const record = await service.stage('i1', 'sale_order', saleOrderRaw);

    const applied = await service.apply(record.id);

    expect(applied.status).toBe('skipped');
    expect(mapping.link).not.toHaveBeenCalled();
    expect((defaultRepos.Product as { save: jest.Mock }).save).not.toHaveBeenCalled();
    expect((defaultRepos.Customer as { save: jest.Mock }).save).not.toHaveBeenCalled();
  });
});

describe('ErpIngestService.apply — retry re-parses a parse-failed row', () => {
  it('sale_order parse-failed row (parsedPayload null, garbage rawPayload) stays failed with the parser error — NOT skipped', async () => {
    const { service } = makeService();
    const record = await service.stage('i1', 'sale_order', { garbage: true }); // parse fails → status failed, parsedPayload null
    expect(record.status).toBe('failed');
    expect(record.parsedPayload).toBeNull();

    const retried = await service.apply(record.id);

    expect(retried.status).toBe('failed');
    expect(retried.error).toContain('ORDER_NUMBER');
  });

  it('product row with parsedPayload null but a now-VALID rawPayload re-parses and applies', async () => {
    const { service, ingestRows, defaultRepos } = makeService();
    const record = await service.stage('i1', 'product', { garbage: true }); // parse fails first
    expect(record.status).toBe('failed');
    expect(record.parsedPayload).toBeNull();
    // Simulate the row being rescued: rawPayload is replaced with a payload the parser can handle.
    ingestRows.get(record.id)!.rawPayload = productRaw;

    const applied = await service.apply(record.id);

    expect(applied.status).toBe('applied');
    expect(applied.parsedPayload).toMatchObject({ sku: 'FISH-SALMON-1KG' });
    expect((defaultRepos.Product as { save: jest.Mock }).save).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'FISH-SALMON-1KG' }),
    );
  });

  it('regression: a normal received product row (parsedPayload already set) still applies', async () => {
    const { service, defaultRepos } = makeService();
    const record = await service.stage('i1', 'product', productRaw);
    expect(record.status).toBe('received');

    const applied = await service.apply(record.id);

    expect(applied.status).toBe('applied');
    expect((defaultRepos.Product as { save: jest.Mock }).save).toHaveBeenCalled();
  });
});

describe('ErpIngestService.apply — generic behavior', () => {
  it('applier throw (repo failure) → failed with the error message, never propagates', async () => {
    const productRepo = makeRepoStub(null, 'p');
    (productRepo.save as jest.Mock).mockRejectedValue(new Error('db down'));
    const { service } = makeService({ productRepo });

    const record = await service.stage('i1', 'product', productRaw);
    const result = await service.apply(record.id);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('db down');
  });

  it('apply() only processes received/failed rows — applied/skipped rows are a no-op', async () => {
    const { service } = makeService();
    const record = await service.stage('i1', 'customer', customerRaw);
    const first = await service.apply(record.id);
    expect(first.status).toBe('applied');

    const second = await service.apply(record.id);
    expect(second).toEqual(first); // unchanged, not re-applied
  });
});

describe('ErpIngestService.stageAndApply — auto-apply policy', () => {
  it('default policy auto-applies product/stock/customer when settings has no override', async () => {
    const existingProduct = { id: 'p1', sku: 'FISH-SALMON-1KG', name: 'X', status: 'active', leadTimeDays: null };
    const productRepo = makeRepoStub(existingProduct, 'p');
    const { service } = makeService({ productRepo, autoApply: null });

    const record = await service.stageAndApply('i1', 'product', productRaw);
    expect(record.status).toBe('applied');
  });

  it('settings override excluding an entity type leaves it "received" (not applied)', async () => {
    const existingProduct = { id: 'p1', sku: 'FISH-SALMON-1KG' };
    const productRepo = makeRepoStub(existingProduct, 'p');
    const { service } = makeService({ productRepo, autoApply: ['product', 'customer'] });

    const record = await service.stageAndApply('i1', 'stock', stockRaw);
    expect(record.status).toBe('received');
  });

  it('sale_order always applies (to land "skipped") even when excluded from the auto-apply list', async () => {
    const { service } = makeService({ autoApply: ['product', 'stock', 'customer'] });
    const record = await service.stageAndApply('i1', 'sale_order', saleOrderRaw);
    expect(record.status).toBe('skipped');
  });

  it('stage parse failure short-circuits stageAndApply — never calls apply on a failed-to-parse row', async () => {
    const { service } = makeService();
    const record = await service.stageAndApply('i1', 'product', { garbage: true });
    expect(record.status).toBe('failed');
  });
});
