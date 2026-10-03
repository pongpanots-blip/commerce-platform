import { createHash } from 'node:crypto';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { catalogFingerprint, catalogPricePerKg, competitorSource } from './competitor-prices.service';

const product = {
  id: 'p-1', sku: 'TEST-MEAT', brandCode: 'B01', brandName: 'Brand', countryCodeSource: 'TH', storageTemperature: 'Chilled',
  packagingType: 'Tray', packSize: '1 KG', unitsPerBox: '10', weightPerUnit: '1', sellingUnit: 'PK', vatType: '0%',
  sellingUnitPrice: '500.00',
  translations: [
    { language_code: 'th', product_name: 'หมู', product_description: null, product_detail: 'สด' },
    { language_code: 'en', product_name: 'Pork', product_description: 'fresh', product_detail: null },
  ],
} as unknown as JoshCatalogProduct;

it('fingerprint matches what josh stored for the same product (verified matches survive the move)', () => {
  // josh competitor-prices.service catalogFingerprint(), verbatim, over the same values in josh's field names.
  const josh = {
    product_inventory_sku: 'TEST-MEAT', brand_code: 'B01', brand_name: 'Brand', country_code_source: 'TH',
    storage_temperature: 'Chilled', packaging_type: 'Tray', pack_size: '1 KG', units_per_box: '10', weight_per_unit: '1',
    selling_unit: 'PK', vat_type: '0%',
    // josh loads translations in heap order — the formula sorts, so order must not matter.
    translations: [...(product.translations ?? [])].reverse(),
  };
  const joshHash = createHash('sha256').update(JSON.stringify([
    josh.product_inventory_sku, josh.brand_code, josh.brand_name,
    josh.country_code_source, josh.storage_temperature, josh.packaging_type,
    josh.pack_size, josh.units_per_box, josh.weight_per_unit,
    josh.selling_unit, josh.vat_type,
    josh.translations?.map(t => [t.language_code, t.product_name, t.product_description, t.product_detail]).sort(),
  ])).digest('hex');
  expect(catalogFingerprint(product)).toBe(joshHash);
  // A price change alone does not invalidate a verified match; a pack change does.
  expect(catalogFingerprint({ ...product, sellingUnitPrice: '450.00' } as JoshCatalogProduct)).toBe(joshHash);
  expect(catalogFingerprint({ ...product, packSize: '2 KG' } as JoshCatalogProduct)).not.toBe(joshHash);
});

it('normalizes selling-unit prices and rejects ambiguous weights or unsafe source URLs', () => {
  expect(catalogPricePerKg(product, 5)).toBe(100);
  expect(catalogPricePerKg({ ...product, sellingUnit: 'KG' } as JoshCatalogProduct, 5)).toBe(500);
  expect(catalogPricePerKg({ ...product, sellingUnit: 'G', sellingUnitPrice: '0.10' } as JoshCatalogProduct, 5)).toBe(100);
  expect(catalogPricePerKg({ ...product, sellingUnit: 'L' } as JoshCatalogProduct, 5)).toBeNull();
  expect(catalogPricePerKg({ ...product, sellingUnitPrice: null } as JoshCatalogProduct, 5)).toBeNull();
  expect(catalogPricePerKg(product, 0)).toBeNull();
  expect(competitorSource('https://www.bigc.co.th/product/meat')).toBe('Big C');
  for (const url of ['http://www.bigc.co.th/product/meat', 'https://localhost/product', 'https://bigc.co.th.evil.test/product', 'https://user:password@www.bigc.co.th/product', 'https://www.bigc.co.th/']) {
    expect(() => competitorSource(url)).toThrow();
  }
});
