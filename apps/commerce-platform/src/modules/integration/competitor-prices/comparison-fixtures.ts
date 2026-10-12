import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { Setting } from "../../core/settings/infrastructure/setting.entity";
import { ScrapingService } from "../../platform/scraping/application/scraping.service";
import {
  ScrapedItem,
  ScrapingSource,
} from "../../platform/scraping/domain/scraping-source.entity";
import {
  PublicWebReader,
  scrapingVersion,
} from "../../platform/scraping/infrastructure/public-web.reader";
import { JoshCatalogProduct } from "../connector/josh/josh-catalog-product.entity";
import { JoshCatalogSyncService } from "../connector/josh/josh-catalog-sync.service";
import { PackInputsService } from "../pack-price-planning/pack-inputs.service";
import {
  CompetitorMatchRejection,
  CompetitorMatchReview,
  CompetitorPrice,
} from "./competitor-price.entity";
import { CompetitorPricesService } from "./competitor-prices.service";
import { CompetitorReviewService } from "./competitor-review.service";
import { ComparisonWorkspaceService } from "./comparison-workspace.service";

export const comparisonFixtureEntities = [
  Setting,
  ScrapingSource,
  ScrapedItem,
  JoshCatalogProduct,
  CompetitorPrice,
  CompetitorMatchReview,
  CompetitorMatchRejection,
];
/** Fixture-only DDL in a verified owned namespace; no application migration or external source call. */
export async function comparisonFixture(db: DataSource, schema: string) {
  if (
    !/^competitor_workspace_fixture_[a-f0-9]{32}$/.test(schema) ||
    db.options.type !== "postgres" ||
    db.options.schema !== schema
  )
    throw Error("Owned comparison fixture namespace required");
  await db.query(`CREATE SCHEMA "${schema}"`);
  for (const table of [
    "josh_catalog_products",
    "commerce_promotion_drafts",
    "commerce_promotion_draft_requests",
  ])
    await db.query(
      `CREATE TABLE "${schema}".${table}(LIKE public.${table} INCLUDING ALL)`,
    );
  const ddl = await db.driver.createSchemaBuilder().log();
  for (const q of ddl.upQueries) {
    if (
      !q.query.includes(`"${schema}"`) ||
      /DROP SCHEMA|DROP TABLE|TRUNCATE/i.test(q.query)
    )
      throw Error("Fixture DDL outside owned schema");
    await db.query(q.query, q.parameters);
  }
  await db.query(
    `ALTER TABLE commerce_promotion_draft_requests ADD CONSTRAINT comparison_fixture_receipt_fk FOREIGN KEY(draft_id) REFERENCES commerce_promotion_drafts(id)`,
  );
  const reader = {
    page: async () => {
      throw Error("Network reads are forbidden in comparison fixtures");
    },
  } as unknown as PublicWebReader;
  const scraping = new ScrapingService(
    db.getRepository(ScrapingSource),
    db.getRepository(ScrapedItem),
    db.getRepository(Setting),
    reader,
  );
  const prices = new CompetitorPricesService(
    db.getRepository(CompetitorPrice),
    db.getRepository(JoshCatalogProduct),
    { configured: false } as JoshCatalogSyncService,
    scraping,
  );
  const inputs = new PackInputsService(prices),
    workspace = new ComparisonWorkspaceService(db, prices, inputs, scraping);
  const review = new CompetitorReviewService(
    db.getRepository(CompetitorPrice),
    db.getRepository(JoshCatalogProduct),
    db.getRepository(CompetitorMatchRejection),
    db.getRepository(CompetitorMatchReview),
    prices,
    scraping,
  );
  const products = [];
  for (const [sku, unit, price] of [
    ["COMPARE-CHICKEN", "KG", "107"],
    ["COMPARE-OIL", "L", "107"],
    ["COMPARE-EACH", "PC", "10"],
  ]) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO josh_catalog_products(id,sku,status,ordering_price,selling_unit,vat_type,translations,josh_updated_at,category_name_th)
      VALUES($1,$2,'active',$3,$4,'7%',$5,now(),'Synthetic comparison')`,
      [
        id,
        sku,
        price,
        unit,
        JSON.stringify([{ language_code: "en", product_name: sku }]),
      ],
    );
    products.push({ id, sku });
  }
  const sources = [];
  for (const [index, currency, member] of [
    [1, "THB", false],
    [2, "THB", false],
    [3, "USD", false],
    [4, "THB", true],
  ] as const) {
    const config = {
      startUrls: [`https://vendor-${index}.example.invalid/list`],
      pathPrefixes: ["/"],
      mode: "html" as const,
      itemSelector: "",
      fields: [],
      autoCards: true,
      currency,
      vatIncluded: true,
      priceContext: "Synthetic public full-pack terms",
      collectionAllowed: true,
      intervalHours: 24,
      maxPages: 10,
      delayMs: 1000,
    };
    const source = await db.getRepository(ScrapingSource).save(
      db.getRepository(ScrapingSource).create({
        name:
          index <= 2
            ? "Same Vendor"
            : member
              ? "Member Vendor"
              : "Foreign Vendor",
        origin: `https://vendor-${index}.example.invalid`,
        enabled: false,
        config,
        loginUsername: member ? "synthetic-fixture" : null,
        loginPasswordEnc: null,
      }),
    );
    sources.push(source);
  }
  const pairs = [];
  for (const [index, source] of sources.entries()) {
    const p = await prices.save({
      sku: products[0].sku,
      ourWeightKg: 1,
      sourceUrl: `${source.origin}/p/chicken`,
      competitorName: `Synthetic chicken ${index + 1}`,
      competitorSku: "",
      competitorWeightKg: index === 1 ? 2 : 1,
      sourceContext: source.config.priceContext,
      vatIncluded: true,
      collectionAllowed: true,
      autoRefresh: false,
    });
    await db.getRepository(CompetitorPrice).update(p.id, {
      priceIncVat: index === 1 ? 180 : 100,
      observedAt: new Date(Date.now() - 3600000),
      captureMethod: "automatic",
      capturedSourceVersion: scrapingVersion(source.config),
    });
    const latest = (await prices.list()).find((x) => x.id === p.id)!;
    await prices.verify(
      p.id,
      "Synthetic same product verified from fixture evidence",
      "fixture-admin@example.invalid",
      latest.revision,
      latest.ourProductVersion,
    );
    pairs.push(p.id);
  }
  const item = await db.getRepository(ScrapedItem).save(
    db.getRepository(ScrapedItem).create({
      sourceId: sources[1].id,
      url: `${sources[1].origin}/p/new-chicken`,
      pageUrl: `${sources[1].origin}/list`,
      name: "Synthetic chicken 500 g",
      sku: "CANDIDATE",
      fields: {},
      priceIncVat: 50,
      weightKg: 0.5,
      currency: "THB",
      configVersion: scrapingVersion(sources[1].config),
      observedAt: new Date(Date.now() - 1800000),
    }),
  );
  return {
    db,
    schema,
    workspace,
    prices,
    inputs,
    scraping,
    review,
    products,
    sources,
    pairs,
    item,
    actor: randomUUID(),
    email: "fixture-admin@example.invalid",
  };
}
