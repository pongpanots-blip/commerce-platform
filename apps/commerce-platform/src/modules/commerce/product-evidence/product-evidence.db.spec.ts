import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { ProductEvidenceService } from "./product-evidence.service";
const url = process.env.PRICE_APPROVAL_TEST_DATABASE_URL;
(url ? describe : describe.skip)("product evidence in owned SQL", () => {
  let db: DataSource, schema: string, before: string;
  const old = { ...process.env };
  const protectedState = async () =>
    JSON.stringify(
      await db.query("SELECT * FROM public.josh_catalog_products ORDER BY id"),
    );
  beforeAll(async () => {
    const u = new URL(url!);
    if (
      u.hostname !== "127.0.0.1" ||
      u.port !== process.env.PRICE_APPROVAL_FIXTURE_PORT ||
      u.pathname !== "/commerce_preview_test" ||
      process.env.PRICE_APPROVAL_FIXTURE_OWNED !==
        "commerce-pack-price-20261009"
    )
      throw Error("Explicit owned local fixture required");
    schema = "price_evidence_fixture_" + randomUUID().replace(/-/g, "");
    db = await new DataSource({
      type: "postgres",
      url,
      schema,
      synchronize: false,
      extra: { options: "-c search_path=" + schema },
    }).initialize();
    before = await protectedState();
    await db.query(`CREATE SCHEMA "${schema}"`);
    for (const sql of [
      "CREATE TABLE product_prices(product_inventory_sku text PRIMARY KEY, selling_unit_price numeric(12,2), ordering_price numeric(12,2), moq int, updated_at timestamptz)",
      "CREATE TABLE product_contents(product_inventory_sku text PRIMARY KEY, fields jsonb, updated_at timestamptz)",
      "CREATE TABLE product_masters(product_inventory_sku text PRIMARY KEY, fields jsonb, updated_at timestamptz)",
      "CREATE TABLE josh_catalog_products(sku text, selling_unit_price numeric(12,2), ordering_price numeric(12,2), moq int, selling_unit text, order_taking_unit text, pack_size text, synced_at timestamptz, removed_at timestamptz)",
      "CREATE TABLE products(id uuid PRIMARY KEY, sku text, organization_id uuid, deleted_at timestamptz)",
      "CREATE TABLE warehouses(id uuid PRIMARY KEY, code text, name text, stock_source text, sellable boolean, organization_id uuid, deleted_at timestamptz)",
      "CREATE TABLE inventory_levels(product_id uuid, warehouse_id uuid, quantity numeric(14,4), reserved numeric(14,4), updated_at timestamptz, organization_id uuid, deleted_at timestamptz)",
    ])
      await db.query(sql);
  });
  afterAll(async () => {
    process.env = old;
    if (db) {
      try {
        expect(await protectedState()).toBe(before);
      } finally {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await db.destroy();
      }
    }
  });
  it("reads actual decimal/null/JSON/warehouse records without copied fallback or writes", async () => {
    process.env.COMMERCE_OWNS_PRICES =
      process.env.COMMERCE_OWNS_PRODUCT_CONTENT =
      process.env.COMMERCE_OWNS_PRODUCT_MASTER =
        "true";
    const sku = " ไทย exact SKU ",
      product = randomUUID(),
      warehouse = randomUUID();
    await db.query("INSERT INTO product_prices VALUES($1,NULL,0,0,now())", [
      sku,
    ]);
    await db.query("INSERT INTO product_contents VALUES($1,$2,now())", [
      sku,
      JSON.stringify({ buying_price: "12.50" }),
    ]);
    await db.query("INSERT INTO product_masters VALUES($1,$2,now())", [
      sku,
      JSON.stringify({ selling_unit: null, order_taking_unit: "BOX" }),
    ]);
    await db.query(
      "INSERT INTO josh_catalog_products(sku,selling_unit_price,selling_unit) VALUES($1,999,'KG')",
      [sku],
    );
    await db.query("INSERT INTO products VALUES($1,$2,NULL,NULL)", [
      product,
      sku,
    ]);
    await db.query(
      "INSERT INTO warehouses VALUES($1,'ERP','Owned synthetic warehouse','erp',false,NULL,NULL)",
      [warehouse],
    );
    await db.query(
      "INSERT INTO inventory_levels VALUES($1,$2,1.2345,0.0001,now(),NULL,NULL)",
      [product, warehouse],
    );
    const beforeRead = JSON.stringify(
      await db.query("SELECT * FROM product_prices"),
    );
    const result = await new ProductEvidenceService(db).item(sku);
    expect(result.prices).toMatchObject({
      sellingUnitPrice: null,
      orderingPrice: "0.00",
      moq: 0,
      source: "native",
      currency: null,
    });
    expect(result.cost).toMatchObject({
      amount: "12.50",
      unit: null,
      currency: null,
      source: "native",
    });
    expect(result.units).toMatchObject({ selling: null, ordering: "BOX" });
    expect(result.stock).toMatchObject({
      status: "recorded",
      unit: null,
      warehouses: [
        {
          quantity: "1.2345",
          reserved: "0.0001",
          owner: "erp",
          sellable: false,
        },
      ],
    });
    expect(JSON.stringify(await db.query("SELECT * FROM product_prices"))).toBe(
      beforeRead,
    );
    await db.query("INSERT INTO products VALUES($1,$2,$3,NULL)", [
      randomUUID(),
      sku,
      randomUUID(),
    ]);
    expect(
      (await new ProductEvidenceService(db).item(sku)).stock,
    ).toMatchObject({ status: "ambiguous_identity", warehouses: [] });
    await expect(
      db.transaction("REPEATABLE READ", async (m) => {
        await m.query("SET TRANSACTION READ ONLY");
        await m.query("DELETE FROM product_prices");
      }),
    ).rejects.toThrow(/read-only/);
    expect(JSON.stringify(await db.query("SELECT * FROM product_prices"))).toBe(
      beforeRead,
    );
  });
});
