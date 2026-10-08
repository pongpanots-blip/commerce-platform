// Stage 3 one-off: seed commerce's stock ledger from josh's current stock (read-only on josh via JOSH_DATABASE_URL /
// commerce_ro) into the SAME default warehouse ERP qty calls use (ERP_DEFAULT_WAREHOUSE_CODE || 'MAIN', stock_source
// 'erp'), creating bare product rows (sku, name = sku) like the ERP feed does.
//   SCRIPT_ARGS='dry-run' (default) — counts only, writes nothing
//   SCRIPT_ARGS='apply'             — writes
// Version-aware + idempotent: every seed movement is dated SEED_AT (2026-10-01, before any stored ERP call), so any ERP
// call or fallback replay (dated when it is applied) is newer and wins in the ledger; a product that already has an
// applied movement in that warehouse is skipped (never overwritten, no stale rows added), so re-running is a no-op.
// No outbox event is published (pre-cutover; stage 3's switch day resends every sellable snapshot).
const SEED_AT = new Date("2026-10-01T00:00:00Z");
const REF = "josh-seed";
const REASON = "JOSH_SEED";

/** Pure: what the seed would do. joshRows [{sku, qty}], existingSkus Set, skusWithMovement Set. */
function plan(joshRows, existingSkus, skusWithMovement) {
  const seen = new Set();
  const out = { josh: joshRows.length, duplicates: 0, invalid: 0, createProducts: [], seed: [], skipHasMovement: 0 };
  for (const r of joshRows) {
    const sku = typeof r.sku === "string" ? r.sku.trim() : "";
    const qty = Number(r.qty);
    if (!sku || !Number.isFinite(qty)) { out.invalid++; continue; }
    if (seen.has(sku)) { out.duplicates++; continue; }
    seen.add(sku);
    if (skusWithMovement.has(sku)) { out.skipHasMovement++; continue; }
    if (!existingSkus.has(sku)) out.createProducts.push(sku);
    out.seed.push({ sku, qty: Math.max(0, Math.floor(qty)) });
  }
  return out;
}

async function main() {
  require("reflect-metadata");
  const mode = (process.env.SCRIPT_ARGS || "dry-run").trim() || "dry-run";
  if (!["dry-run", "apply"].includes(mode)) throw new Error("SCRIPT_ARGS must be dry-run | apply");
  const { Client } = require("pg");
  const j = new Client({ connectionString: process.env.JOSH_DATABASE_URL, options: "-c default_transaction_read_only=on -c statement_timeout=120000" });
  await j.connect();
  const joshRows = (await j.query(`SELECT product_inventory_sku AS sku, product_inventory_quantity AS qty FROM product_inventory WHERE product_inventory_sku IS NOT NULL`)).rows;
  await j.end();

  const { AppDataSource } = require("./src/data-source");
  const { Product } = require("./src/modules/commerce/product/infrastructure/product.entity");
  const { Warehouse } = require("./src/modules/commerce/warehouse/infrastructure/warehouse.entity");
  const { InventoryLedgerService } = require("./src/modules/commerce/inventory/application/inventory-ledger.service");
  const db = await AppDataSource.initialize();
  try {
    const code = process.env.ERP_DEFAULT_WAREHOUSE_CODE?.trim() || "MAIN";
    let warehouse = await db.getRepository(Warehouse).findOne({ where: { code }, order: { createdAt: "ASC" } });
    const existingSkus = new Set((await db.query(`SELECT sku FROM products WHERE deleted_at IS NULL`)).map((r) => r.sku));
    const withMovement = new Set(warehouse ? (await db.query(
      `SELECT DISTINCT p.sku FROM inventory_movements m JOIN products p ON p.id = m.product_id WHERE m.warehouse_id = $1 AND m.status = 'applied'`, [warehouse.id])).map((r) => r.sku) : []);
    const p = plan(joshRows, existingSkus, withMovement);
    const summary = { mode, warehouse: { code, exists: !!warehouse, stockSource: warehouse?.stockSource ?? "erp (new)", sellable: warehouse?.sellable ?? true },
      joshRows: p.josh, duplicates: p.duplicates, invalid: p.invalid, productsToCreate: p.createProducts.length, toSeed: p.seed.length,
      toSeedWithStock: p.seed.filter((r) => r.qty > 0).length, unitsToSeed: p.seed.reduce((a, r) => a + r.qty, 0), skippedHasMovement: p.skipHasMovement, seedAt: SEED_AT.toISOString() };
    console.log(JSON.stringify(summary, null, 1));
    if (mode !== "apply") return;
    if (warehouse && warehouse.stockSource !== "erp") throw new Error(`warehouse ${code} is stock_source=${warehouse.stockSource}; refusing`);
    warehouse ??= await db.getRepository(Warehouse).save(db.getRepository(Warehouse).create({ code, name: code }));
    const ledger = new InventoryLedgerService({ publish: async () => undefined });
    let applied = 0, skipped = 0, created = 0;
    for (let i = 0; i < p.seed.length; i += 200) {
      await db.transaction(async (m) => {
        for (const { sku, qty } of p.seed.slice(i, i + 200)) {
          let product = await m.getRepository(Product).findOne({ where: { sku } });
          if (!product) { product = await m.getRepository(Product).save(m.getRepository(Product).create({ sku, name: sku })); created++; }
          const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM inventory_movements WHERE product_id = $1 AND warehouse_id = $2 AND status = 'applied'`, [product.id, warehouse.id]);
          if (n > 0) { skipped++; continue; }
          const r = await ledger.recordExternalQuantity(m, { productId: product.id, warehouse, source: "erp", quantity: qty, reason: REASON, occurredAt: SEED_AT, ref: REF });
          if (r.status === "applied") applied++; else skipped++;
        }
      });
    }
    const [after] = await db.query(`SELECT count(*)::int AS levels, count(*) FILTER (WHERE quantity > 0)::int AS with_stock, coalesce(sum(quantity),0)::bigint AS units FROM inventory_levels WHERE warehouse_id = $1 AND deleted_at IS NULL`, [warehouse.id]);
    console.log(JSON.stringify({ applied, skipped, productsCreated: created, warehouse: code, after }, null, 1));
  } finally { await db.destroy(); }
}

if (typeof module !== "undefined") module.exports = { plan, SEED_AT };
if (!process.env.STOCK_SEED_TEST) main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
