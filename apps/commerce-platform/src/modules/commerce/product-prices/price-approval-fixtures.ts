import { DataSource } from "typeorm";
import { EventEmitterBus } from "../../../shared-kernel/infrastructure/event-emitter.bus";
import { OutboxMessage } from "../../../shared-kernel/infrastructure/outbox.entity";
import { ProductPricesService } from "./product-prices.service";
import { PriceApprovalService } from "./price-approval.service";
/** Owned synthetic native tables only. No application migrations or external source. */
export async function priceApprovalFixture(db: DataSource, schema: string) {
  if (
    !/^price_approval_fixture_[a-f0-9]{32}$/.test(schema) ||
    db.options.type !== "postgres" ||
    db.options.schema !== schema
  )
    throw Error("Owned price approval namespace required");
  await db.query(`CREATE SCHEMA "${schema}"`);
  for (const table of [
    "commerce_promotion_drafts",
    "commerce_promotion_draft_requests",
  ])
    await db.query(
      `CREATE TABLE "${schema}".${table}(LIKE public.${table} INCLUDING ALL)`,
    );
  await db.query(
    "ALTER TABLE commerce_promotion_draft_requests ADD CONSTRAINT price_fixture_receipt_fk FOREIGN KEY(draft_id) REFERENCES commerce_promotion_drafts(id)",
  );
  await db.query(
    "CREATE TABLE product_prices(product_inventory_sku varchar(64) PRIMARY KEY,selling_unit_price numeric(12,2),ordering_price numeric(12,2),moq int,source varchar(16) NOT NULL DEFAULT 'import',updated_by text,updated_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.query(
    "CREATE TABLE product_price_pending(product_inventory_sku varchar(64) PRIMARY KEY,selling_unit_price numeric(12,2),ordering_price numeric(12,2),moq int,changed_at timestamptz,received_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.query("CREATE TABLE josh_catalog_products(sku text PRIMARY KEY)");
  for (const query of (await db.driver.createSchemaBuilder().log()).upQueries) {
    if (
      !query.query.includes(`"${schema}"`) ||
      /DROP TABLE|DROP SCHEMA|TRUNCATE/i.test(query.query)
    )
      throw Error("Fixture DDL outside owned schema");
    await db.query(query.query, query.parameters);
  }
  const events = new EventEmitterBus(db.getRepository(OutboxMessage)),
    prices = new ProductPricesService(db, events),
    approval = new PriceApprovalService(db, prices);
  const seed = async (sku = "SYNTHETIC-PRICE-1", amount = 12.5) => {
    await db.query(
      "INSERT INTO product_prices(product_inventory_sku,selling_unit_price,ordering_price,moq) VALUES($1,10,100,1) ON CONFLICT(product_inventory_sku) DO UPDATE SET selling_unit_price=10,ordering_price=100,moq=1,updated_at=clock_timestamp()",
      [sku],
    );
    await prices.stage(
      db.manager,
      sku,
      { sellingUnitPrice: amount },
      new Date("2026-10-10T01:00:00.123Z"),
    );
  };
  return { events, prices, approval, seed };
}
