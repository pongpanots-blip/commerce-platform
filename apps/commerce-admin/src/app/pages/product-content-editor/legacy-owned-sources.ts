import { z } from "zod";
import {
  orderingApi,
  productContentsApi,
  productMastersApi,
  productPricesApi,
} from "../../../lib/api";

const ownershipSchema = z.object({
  productContent: z.boolean(),
  productMaster: z.boolean(),
  ordering: z.boolean(),
});
const rowSchema = z.object({
  sku: z.string(),
  fields: z.record(z.string(), z.unknown()),
});
const contentKeys = [
  "product_name_th",
  "product_name_en",
  "product_description_th",
  "product_description_en",
  "ingredients",
  "allergens",
  "expiration_info",
  "usage_direction",
  "best_paired_food",
  "storage_temperature",
  "maximum_shelf_life",
  "is_organic",
  "product_short_code",
  "buying_price",
  "low_stock_threshold",
  "reorder_quantity",
];
const masterKeys = [
  "order_taking_flag",
  "sup_code",
  "selling_unit",
  "order_taking_unit",
  "erp_ordering_units",
  "pack_size",
  "packaging_type",
  "units_per_box",
  "weight_per_unit",
  "brand_name",
  "vat_type",
  "marketed_by",
  "product_type",
  "season_start",
  "season_end",
  "product_status",
  "category_code",
];
const logisticsKeys = [
  "unit_ratio",
  "sub_packing_unit",
  "product_unit",
  "expected_restock_at",
  "delivery_dates",
];
export interface LegacyOwnedSources {
  fields: Record<string, unknown> | null;
  ownedKeys: string[];
  ordering: boolean;
  missing: string[];
}
export async function readLegacyOwnedSources(
  sku: string,
): Promise<LegacyOwnedSources> {
  const owned = ownershipSchema.parse(await productPricesApi.ownership());
  const missing: string[] = [];
  async function load(name: string, read: () => Promise<unknown>) {
    try {
      const row = rowSchema.parse(await read());
      if (row.sku !== sku)
        throw Error("Native product source returned a different SKU");
      return row.fields;
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      missing.push(name);
      return {};
    }
  }
  const [content, master, logistics] = await Promise.all([
    owned.productContent
      ? load("content", () => productContentsApi.get(sku))
      : {},
    owned.productMaster ? load("master", () => productMastersApi.get(sku)) : {},
    owned.ordering ? load("logistics", () => orderingApi.logistics(sku)) : {},
  ]);
  const ownedKeys = [
    ...(owned.productContent ? contentKeys : []),
    ...(owned.productMaster ? masterKeys : []),
    ...(owned.ordering ? logisticsKeys : []),
  ];
  return {
    fields: ownedKeys.length ? { ...content, ...master, ...logistics } : null,
    ownedKeys,
    ordering: owned.ordering,
    missing: missing.sort(),
  };
}
/** Owned missing keys and explicit null never seed a copied editing default. */
export function legacyOwnedValue(
  key: string,
  sources: LegacyOwnedSources,
  copiedValue: () => unknown,
) {
  return sources.ownedKeys.includes(key)
    ? sources.fields?.[key]
    : copiedValue();
}
