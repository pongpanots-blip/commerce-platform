import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * The catalog copy in josh's ProductInventory field names. Helpers ported from josh (competitor-size, the offer
 * text, the review grid) take this shape, so their bodies stay byte-identical to josh and later josh fixes diff in.
 */
export type InventoryShape = ReturnType<typeof toInventoryShape>;

export function toInventoryShape(p: JoshCatalogProduct) {
  return {
    product_inventory_id: p.id, product_inventory_sku: p.sku, product_status: p.status,
    brand_code: p.brandCode, brand_name: p.brandName, country_code_source: p.countryCodeSource,
    storage_temperature: p.storageTemperature, packaging_type: p.packagingType, pack_size: p.packSize,
    units_per_box: p.unitsPerBox, weight_per_unit: p.weightPerUnit, selling_unit: p.sellingUnit, vat_type: p.vatType,
    selling_unit_price: p.sellingUnitPrice, ordering_price: p.orderingPrice, order_taking_unit: p.orderTakingUnit,
    translations: p.translations ?? [],
    productCategory: { category_name_th: p.categoryNameTh, category_name_en: p.categoryNameEn },
    image_url: p.imageUrl, updated_at: p.joshUpdatedAt,
  };
}
