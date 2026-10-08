// Stage 3 parity (read-only both sides): josh product_inventory_quantity vs commerce sellable stock per SKU
// (sum over sellable warehouses of max(quantity - reserved, 0)), plus ERP fallback replay progress.
async function main() {
  require("reflect-metadata");
  const { Client } = require("pg");
  const j = new Client({ connectionString: process.env.JOSH_DATABASE_URL, options: "-c default_transaction_read_only=on -c statement_timeout=120000" });
  await j.connect();
  const josh = new Map((await j.query(`SELECT product_inventory_sku AS sku, product_inventory_quantity AS qty FROM product_inventory WHERE product_inventory_sku IS NOT NULL`)).rows
    .map((r) => [String(r.sku).trim(), Math.max(0, Math.floor(Number(r.qty) || 0))]));
  await j.end();
  const { AppDataSource } = require("./src/data-source");
  const db = await AppDataSource.initialize();
  try {
    const com = new Map((await db.query(
      `SELECT p.sku, SUM(GREATEST(l.quantity - l.reserved, 0))::bigint AS qty FROM inventory_levels l
         JOIN warehouses w ON w.id = l.warehouse_id AND w.sellable AND w.deleted_at IS NULL
         JOIN products p ON p.id = l.product_id WHERE l.deleted_at IS NULL GROUP BY p.sku`)).map((r) => [r.sku, Number(r.qty)]));
    const skus = new Set([...josh.keys(), ...com.keys()]);
    const diffs = [];
    for (const s of skus) { const a = josh.get(s) ?? 0, b = com.get(s) ?? 0; if (a !== b) diffs.push({ sku: s, josh: a, commerce: b }); }
    const side = (m) => ({ skus: m.size, skusWithStock: [...m.values()].filter((q) => q > 0).length, units: [...m.values()].reduce((x, q) => x + q, 0) });
    const replay = await db.query(`SELECT count(*) FILTER (WHERE path ~ '/products/qty$')::int AS qty_calls,
        count(*) FILTER (WHERE path ~ '/products/qty$' AND processed_at IS NULL)::int AS qty_unprocessed,
        count(*) FILTER (WHERE processed_at IS NULL)::int AS all_unprocessed, max(received_at) AS last_received FROM josh_erp_fallback_calls`);
    const movements = await db.query(`SELECT source, status, (ref = 'josh-seed') AS seed, count(*)::int AS n FROM inventory_movements GROUP BY 1,2,3 ORDER BY 1,2,3`);
    console.log(JSON.stringify({ josh: side(josh), commerce: side(com), skusCompared: skus.size, skuDiffs: diffs.length,
      diffUnits: diffs.reduce((x, d) => x + Math.abs(d.josh - d.commerce), 0), sampleDiffs: diffs.slice(0, 15), replay: replay[0], movements }, null, 1));
  } finally { await db.destroy(); }
}
main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
