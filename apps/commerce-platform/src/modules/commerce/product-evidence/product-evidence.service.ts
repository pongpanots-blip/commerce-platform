import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { manualPriceSkuSchema } from "../product-prices/manual-price-contracts";
import {
  productEvidenceSchema,
  type ProductEvidence,
} from "./product-evidence-contracts";

type Row = Record<string, any>;
const timestamp = (v: unknown) =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;
const scalar = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? v : null;
const source = (row: Row | undefined, owned: boolean) =>
  row
    ? owned
      ? ("native" as const)
      : ("archived_native" as const)
    : ("unavailable" as const);

/** Read existing records together. Record times never assert source freshness or unit conversion. */
@Injectable()
export class ProductEvidenceService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async item(rawSku: string): Promise<ProductEvidence> {
    const parsed = manualPriceSkuSchema.safeParse(rawSku);
    if (!parsed.success) throw new BadRequestException("Invalid SKU");
    const sku = parsed.data;
    const ownsPrices = process.env.COMMERCE_OWNS_PRICES === "true";
    const ownsContent = process.env.COMMERCE_OWNS_PRODUCT_CONTENT === "true";
    const ownsMaster = process.env.COMMERCE_OWNS_PRODUCT_MASTER === "true";
    return this.db.transaction("REPEATABLE READ", async (m) => {
      await m.query("SET TRANSACTION READ ONLY");
      await m.query("SET LOCAL statement_timeout = '1500ms'");
      const [price] = await m.query(
        "SELECT selling_unit_price, ordering_price, moq, updated_at FROM product_prices WHERE product_inventory_sku = $1",
        [sku],
      );
      const [content] = await m.query(
        "SELECT fields, updated_at FROM product_contents WHERE product_inventory_sku = $1",
        [sku],
      );
      const [master] = await m.query(
        "SELECT fields, updated_at FROM product_masters WHERE product_inventory_sku = $1",
        [sku],
      );
      // Never COALESCE cleared or missing owned values with the delayed catalog copy.
      const copies: Row[] = await m.query(
        "SELECT selling_unit_price, ordering_price, moq, selling_unit, order_taking_unit, pack_size, synced_at FROM josh_catalog_products WHERE sku = $1 AND removed_at IS NULL",
        [sku],
      );
      const copy = copies.length === 1 ? copies[0] : undefined;
      const selectedPrice = ownsPrices ? price : copy;
      const priceSource = ownsPrices
        ? source(price, true)
        : copy
          ? ("copied_snapshot" as const)
          : source(price, false);
      const p = selectedPrice ?? price;
      const unitRow = ownsMaster ? master : copy;
      const unitFields = ownsMaster ? master?.fields : copy;
      const products: Row[] = await m.query(
        "SELECT id, organization_id FROM products WHERE sku = $1 AND deleted_at IS NULL",
        [sku],
      );
      let status: ProductEvidence["stock"]["status"] =
        products.length > 1
          ? "ambiguous_identity"
          : products.length === 0
            ? "unavailable"
            : products[0].organization_id
              ? "organization_scope_unavailable"
              : "recorded";
      // A bare SKU cannot authorize an organization-scoped stock identity.
      const levels: Row[] =
        status === "recorded"
          ? await m.query(
              `SELECT w.code, w.name, w.stock_source, w.sellable, i.quantity::text, i.reserved::text, i.updated_at
        FROM inventory_levels i JOIN warehouses w ON w.id = i.warehouse_id
        WHERE i.product_id = $1 AND i.deleted_at IS NULL AND i.organization_id IS NULL AND w.deleted_at IS NULL AND w.organization_id IS NULL
        ORDER BY w.code, w.id`,
              [products[0].id],
            )
          : [];
      if (status === "recorded" && levels.length === 0) status = "unavailable";
      return productEvidenceSchema.parse({
        sku,
        capturedAt: new Date().toISOString(),
        freshness: "unverified",
        prices: {
          source: priceSource,
          recordedAt: timestamp(p?.updated_at ?? p?.synced_at),
          sellingUnitPrice: scalar(p?.selling_unit_price),
          orderingPrice: scalar(p?.ordering_price),
          moq: scalar(p?.moq),
          currency: null,
          taxBasis: null,
        },
        cost: {
          source: source(content, ownsContent),
          recordedAt: timestamp(content?.updated_at),
          amount: scalar(content?.fields?.buying_price),
          currency: null,
          unit: null,
          taxBasis: null,
          observedAt: null,
        },
        units: {
          source: ownsMaster
            ? source(master, true)
            : copy
              ? "copied_snapshot"
              : "unavailable",
          recordedAt: timestamp(unitRow?.updated_at ?? unitRow?.synced_at),
          selling: scalar(unitFields?.selling_unit),
          ordering: scalar(unitFields?.order_taking_unit),
          packSize: scalar(unitFields?.pack_size),
        },
        stock: {
          status,
          unit: null,
          observedAt: null,
          warehouses: levels.map((l) => ({
            code: l.code,
            name: l.name,
            owner: l.stock_source,
            sellable: l.sellable,
            quantity: l.quantity,
            reserved: l.reserved,
            recordedAt: timestamp(l.updated_at),
          })),
        },
      });
    });
  }
}
