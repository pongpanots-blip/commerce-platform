import { PromotionInputsService } from './promotion-inputs.service';
const scenario = { name: 'Review only', line: { sku: 'SKU', quantity: 2, unit: 'PC', quantityKind: 'count' }, proposedValue: { type: 'percentage', percent: 10 }, minimumGrossMarginPercent: null };
describe('server promotion observations', () => {
  const query = jest.fn(); let service: PromotionInputsService;
  const flags = ['COMMERCE_OWNS_PRICES', 'COMMERCE_OWNS_PRODUCT_MASTER', 'COMMERCE_OWNS_PROMOTIONS'];
  let previous: Array<string | undefined>;
  beforeEach(() => {
    previous = flags.map(key => process.env[key]); flags.forEach(key => delete process.env[key]); query.mockReset();
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      expect(sql).toMatch(/^SELECT /); expect(params).toEqual(['SKU']);
      if (sql.includes('FROM josh_catalog_products')) return [{ id: 'catalog-id', sku: 'SKU', selling_unit: 'PC', packaging_type: 'fixed', pack_size: '1 PC', vat_type: '7%', selling_unit_price: '107.00', source_version: '5', synced_at: '2026-10-01T00:00:00Z', buying_price: '50', customer_secret: 'never project' }];
      if (sql.includes('FROM product_promotion_rules')) return [{ rules: [], shadow_rules: [], version: '3', shadow_version: '5', lock: null, lock_version: '5' }];
      if (sql.includes('FROM product_prices')) return [{ selling_unit_price: null, updated_at: '2026-10-09T00:00:00Z' }];
      if (sql.includes('FROM product_masters')) return [{ fields: { selling_unit: 'KG', packaging_type: 'approx', vat_type: '0%' }, updated_at: '2026-10-09T00:00:00Z' }];
      throw new Error('Unexpected source');
    }); service = new PromotionInputsService({ query } as never);
  });
  afterEach(() => flags.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]));
  it('keeps source time, redacts unrelated fields and leaves cost/stock/freshness unavailable', async () => {
    const result = await service.inputs(' SKU ', () => new Date('2026-10-09T14:00:00Z'));
    expect(result).toMatchObject({ sku: 'SKU', observedAt: '2026-10-09T14:00:00.000Z', sourceFreshness: 'unavailable', cost: null, stock: null,
      price: { unitPrice: '107.00', vatRateBasisPoints: 700, sourceAsOf: '2026-10-01T00:00:00.000Z' } });
    expect(JSON.stringify(result)).not.toContain('buying_price'); expect(JSON.stringify(result)).not.toContain('never project');
  });
  it('shows useful isolated selling-price arithmetic while blocking fake profit, persistence and readiness', async () => {
    const result = await service.preview(scenario);
    expect(result.preview).toMatchObject({ status: 'incomplete', persisted: false, activationAllowed: false, inputAuthority: 'server_read_observations', amounts: { beforeDiscountMinor: 21400, afterDiscountMinor: 19260, grossProfitMinor: null } });
    expect(result.preview.issues.map(i => i.code)).toEqual(expect.arrayContaining(['source_freshness_unavailable', 'promotion_capacity_unavailable', 'cost_unavailable', 'stock_unavailable']));
  });
  it('does not override missing owned prices with copied prices or owned metadata with copied units', async () => {
    process.env.COMMERCE_OWNS_PRICES = 'true'; process.env.COMMERCE_OWNS_PRODUCT_MASTER = 'true';
    const result = await service.inputs('SKU'); expect(result.price.unitPrice).toBeNull(); expect(result.product.unit).toBe('KG'); expect(result.product.packagingType).toBe('approx');
    expect(result.price.vatRateBasisPoints).toBe(0);
  });
  it('rejects identity ambiguity and invalid SKU before reads', async () => {
    await expect(service.inputs('')).rejects.toThrow('Invalid SKU'); await expect(service.inputs('SKU\n')).rejects.toThrow('Invalid SKU'); expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce([{}, {}]); await expect(service.inputs('SKU')).rejects.toThrow('ambiguous');
  });
  it('handles missing rows and source failures without returning query secrets or fabricated emptiness', async () => {
    query.mockResolvedValueOnce([]); await expect(service.inputs('SKU')).rejects.toThrow('not found');
    query.mockRejectedValueOnce(new Error('postgres credential SQL')); await expect(service.inputs('SKU')).rejects.toThrow('Catalog observations are unavailable');
    query.mockImplementationOnce(async () => [{ id: 'catalog-id', selling_unit: 'PC', packaging_type: 'fixed', vat_type: null, selling_unit_price: '10.00' }]);
    const result = await service.preview(scenario); expect(result.preview.amounts?.grossProfitMinor).toBeNull(); expect(result.inputs.price.vatRateBasisPoints).toBeNull();
  });
  it('rejects unsupported count quantity, unit mismatch, approximate basis and caller-injected cost', async () => {
    const fraction = await service.preview({ ...scenario, line: { ...scenario.line, quantity: 1.5 } }); expect(fraction.preview.status).toBe('rejected');
    const mismatch = await service.preview({ ...scenario, line: { ...scenario.line, unit: 'BX' } }); expect(mismatch.preview.issues.map(i => i.code)).toContain('selling_price_identity_currency_or_uom_mismatch');
    process.env.COMMERCE_OWNS_PRODUCT_MASTER = 'true'; const approx = await service.preview({ ...scenario, line: { ...scenario.line, unit: 'KG', quantityKind: 'measure' } }); expect(approx.preview.issues.map(i => i.code)).toContain('approx_or_unknown_price_basis_unsupported');
    await expect(service.preview({ ...scenario, cost: { buying_price: 1 } })).rejects.toThrow();
  });
});
