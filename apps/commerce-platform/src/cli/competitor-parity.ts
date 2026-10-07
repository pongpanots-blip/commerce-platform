/**
 * Stage 1 cutover check: every verified competitor pair must stay verified on commerce's catalog copy.
 *
 *   npm run competitor-parity
 *
 * Recomputes catalogFingerprint (same formula as josh) for each pair's product in josh_catalog_products and
 * compares it with the stored verified_fingerprint. `mismatched` > 0 means those pairs would show "รอตรวจ"
 * after the switch — usually the catalog copy is behind (run the catalog backfill and wait for the outbox).
 * Pairs read through a scraping source mix the source's reader version into the fingerprint; those are compared
 * the same way the service does. Commerce side: the normal COMMERCE_DB_* / COMMERCE_DATABASE_URL env.
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { AppDataSource } from '../data-source';
import { scrapingVersion } from '../modules/platform/scraping/infrastructure/public-web.reader';
import { toInventoryShape } from '../modules/integration/competitor-prices/catalog-shape';
import { catalogFingerprint } from '../modules/integration/competitor-prices/competitor-prices.service';
import { JoshCatalogProduct } from '../modules/integration/connector/josh/josh-catalog-product.entity';

async function main() {
  const db = await AppDataSource.initialize();
  try {
    const rows: { id: string; product_id: string; verified_fingerprint: string; config: never | null }[] = await db.query(
      `SELECT cp.id, cp.product_id, cp.verified_fingerprint, s.config FROM competitor_prices cp
         LEFT JOIN scraping_sources s ON s.id = cp.scraping_source_id WHERE cp.verified_fingerprint IS NOT NULL`);
    const products = db.getRepository(JoshCatalogProduct);
    const mismatched: string[] = [];
    for (const row of rows) {
      const product = await products.findOneBy({ id: row.product_id });
      const fp = product && catalogFingerprint(toInventoryShape(product));
      const expected = fp && row.config ? createHash('sha256').update(fp + scrapingVersion(row.config)).digest('hex') : fp;
      if (expected !== row.verified_fingerprint && fp !== row.verified_fingerprint) mismatched.push(row.id);
    }
    console.log(JSON.stringify({ verifiedPairs: rows.length, same: rows.length - mismatched.length, mismatched }));
    if (mismatched.length) process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
