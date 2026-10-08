// Stage 3 cutover: inventory.sellable.snapshot for every commerce product with stock rows WHOSE SKU JOSH CARRIES
// (josh product_inventory, read-only). Same event as POST /stock/sellable-snapshots/resend / ledger.publishSellable
// (sum over sellable warehouses of max(quantity - reserved, 0), version = now, outbox row + NOTIFY), minus SKUs josh
// doesn't have: josh answers 422 for those ("failed for <sku>") and commerce dead-letters them.
// SCRIPT_ARGS: '' = dry run (counts + the skipped SKUs); 'apply=1' = write the outbox rows (500 per transaction).
async function main() {
  require("reflect-metadata");
  const apply = /(^|\s)apply=1(\s|$)/.test(process.env.SCRIPT_ARGS || "");
  const { Client } = require("pg");
  const j = new Client({ connectionString: process.env.JOSH_DATABASE_URL, options: "-c default_transaction_read_only=on -c statement_timeout=120000" });
  await j.connect();
  const joshSkus = new Set((await j.query(`SELECT product_inventory_sku AS sku FROM product_inventory WHERE product_inventory_sku IS NOT NULL`)).rows.map((r) => String(r.sku).trim()));
  await j.end();
  const { AppDataSource } = require("./src/data-source");
  const db = await AppDataSource.initialize();
  try {
    const rows = await db.query(
      `SELECT p.id, p.sku, COALESCE(SUM(GREATEST(l.quantity - l.reserved, 0)) FILTER (WHERE w.sellable), 0)::int AS qty
         FROM products p JOIN inventory_levels l ON l.product_id = p.id AND l.deleted_at IS NULL
         LEFT JOIN warehouses w ON w.id = l.warehouse_id AND w.deleted_at IS NULL
        WHERE p.deleted_at IS NULL GROUP BY p.id, p.sku ORDER BY p.id`);
    const send = rows.filter((r) => r.sku && joshSkus.has(String(r.sku).trim()));
    const skipped = rows.filter((r) => !(r.sku && joshSkus.has(String(r.sku).trim()))).map((r) => ({ sku: r.sku, qty: Number(r.qty) }));
    let written = 0;
    if (apply) {
      for (let i = 0; i < send.length; i += 500) {
        await db.transaction(async (m) => {
          for (const r of send.slice(i, i + 500)) {
            const version = new Date().toISOString(), qty = Number(r.qty);
            const payload = { sku: r.sku, sellableQty: qty, version, erp: { PRODUCT_CODE: r.sku, QUANTITY: qty, CHANGED_AT: version } };
            await m.query(`INSERT INTO outbox_messages (type, aggregate_id, payload, metadata, status, attempts, published_at, created_at)
              VALUES ('inventory.sellable.snapshot', $1, $2::jsonb, '{"snapshot":true}'::jsonb, 'pending', 0, NULL, clock_timestamp())`, [r.id, JSON.stringify(payload)]);
            written++;
          }
          await m.query(`SELECT pg_notify('outbox_pending', '')`);
        });
      }
    }
    console.log(JSON.stringify({ apply, productsWithStockRows: rows.length, joshSkus: joshSkus.size, toSend: send.length,
      units: send.reduce((x, r) => x + Number(r.qty), 0), written, skippedNotInJosh: skipped }, null, 1));
  } finally { await db.destroy(); }
}
main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
