import "reflect-metadata";
import { DataSource } from "typeorm";
import { ProductEvidenceService } from "./product-evidence.service";

describe("product evidence source boundaries", () => {
  let tables: Record<string, any[]>,
    queries: [string, unknown[]?][],
    service: ProductEvidenceService;
  const old = { ...process.env };
  beforeEach(() => {
    process.env.COMMERCE_OWNS_PRICES = "true";
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = "true";
    process.env.COMMERCE_OWNS_PRODUCT_MASTER = "true";
    queries = [];
    tables = {
      product_prices: [
        { selling_unit_price: null, ordering_price: "0.00", moq: 0 },
      ],
      product_contents: [{ fields: { buying_price: 0 } }],
      product_masters: [
        { fields: { selling_unit: null, order_taking_unit: "BOX" } },
      ],
      josh_catalog_products: [
        {
          selling_unit_price: "100.00",
          selling_unit: "KG",
          pack_size: "10 KG",
        },
      ],
      products: [{ id: "p", organization_id: null }],
      inventory_levels: [
        {
          code: "ERP",
          name: "ERP warehouse",
          stock_source: "erp",
          sellable: false,
          quantity: "0.0000",
          reserved: "0.0000",
          updated_at: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    };
    service = new ProductEvidenceService({
      transaction: async (isolation: string, fn: any) => {
        expect(isolation).toBe("REPEATABLE READ");
        return fn({
          query: async (sql: string, params?: unknown[]) => {
            queries.push([sql, params]);
            const table = /FROM (\w+)/.exec(sql)?.[1];
            return table ? (tables[table] ?? []) : [];
          },
        });
      },
    } as unknown as DataSource);
  });
  afterAll(() => {
    process.env = old;
  });
  it("keeps cleared native values and zero, with independent missing unit/currency/freshness contracts", async () => {
    const result = await service.item(" exact ไทย SKU ");
    expect(result.sku).toBe(" exact ไทย SKU ");
    expect(result.prices).toMatchObject({
      source: "native",
      sellingUnitPrice: null,
      orderingPrice: "0.00",
      moq: 0,
      currency: null,
      taxBasis: null,
    });
    expect(result.cost).toMatchObject({
      amount: 0,
      unit: null,
      currency: null,
      observedAt: null,
    });
    expect(result.units).toMatchObject({
      selling: null,
      ordering: "BOX",
      packSize: null,
    });
    expect(result.stock).toMatchObject({
      status: "recorded",
      unit: null,
      observedAt: null,
      warehouses: [{ owner: "erp", sellable: false, quantity: "0.0000" }],
    });
    expect(result.freshness).toBe("unverified");
    expect(queries[0][0]).toBe("SET TRANSACTION READ ONLY");
    expect(
      queries
        .filter(([sql]) => /FROM/.test(sql))
        .every(([, p]) => p?.[0] === " exact ไทย SKU " || p?.[0] === "p"),
    ).toBe(true);
    expect(
      queries.some(([sql]) => /\b(INSERT|UPDATE|DELETE|COALESCE)\b/i.test(sql)),
    ).toBe(false);
  });
  it("uses a labelled snapshot only when price/master ownership is disabled, and labels stored cost as archived", async () => {
    process.env.COMMERCE_OWNS_PRICES =
      process.env.COMMERCE_OWNS_PRODUCT_MASTER =
      process.env.COMMERCE_OWNS_PRODUCT_CONTENT =
        "false";
    const r = await service.item("S");
    expect(r.prices).toMatchObject({
      source: "copied_snapshot",
      sellingUnitPrice: "100.00",
    });
    expect(r.units).toMatchObject({ source: "copied_snapshot", selling: "KG" });
    expect(r.cost.source).toBe("archived_native");
  });
  it("does not resurrect missing owned rows from a copied record", async () => {
    tables.product_prices =
      tables.product_contents =
      tables.product_masters =
        [];
    const r = await service.item("S");
    expect(r.prices).toMatchObject({
      source: "unavailable",
      sellingUnitPrice: null,
    });
    expect(r.cost).toMatchObject({ source: "unavailable", amount: null });
    expect(r.units).toMatchObject({ source: "unavailable", selling: null });
  });
  it.each([
    { products: [] },
    { products: [{ id: "p", organization_id: "tenant" }] },
    {
      products: [
        { id: "p", organization_id: null },
        { id: "p2", organization_id: "tenant" },
      ],
    },
  ])(
    "does not guess stock identity or tenant scope: %j",
    async ({ products }) => {
      tables.products = products;
      const r = await service.item("S");
      expect(r.stock.status).toBe(
        products.length > 1
          ? "ambiguous_identity"
          : products.length
            ? "organization_scope_unavailable"
            : "unavailable",
      );
      expect(r.stock.warehouses).toEqual([]);
      expect(
        queries.some(([sql]) => sql.includes("FROM inventory_levels")),
      ).toBe(false);
    },
  );
  it("empty levels are unavailable, not zero, and invalid identifiers never reach SQL", async () => {
    tables.inventory_levels = [];
    expect((await service.item("S")).stock.status).toBe("unavailable");
    queries = [];
    for (const sku of [" ", "x\0y", "a".repeat(65)])
      await expect(service.item(sku)).rejects.toThrow("Invalid SKU");
    expect(queries).toEqual([]);
  });
});
