/**
 * Stage 4e check: does josh show the gallery commerce has?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run image-parity
 *
 * Per SKU commerce has a gallery for, the ordered image URLs vs josh's image rows. SKUs only josh has a gallery for
 * (created after the import, the ERP's one image) are listed as joshOnly. Exit code 1 when anything differs.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { JOSH_IMAGES_SQL } from '../modules/commerce/product-images/josh-images.sql';

type Row = { sku: string; images: string[] };

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { console.error('JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const [a, b]: [Row[], Row[]] = await Promise.all([
      josh.query(JOSH_IMAGES_SQL),
      commerce.query(`SELECT product_inventory_sku AS sku, images FROM product_images`),
    ]);
    const theirs = new Map(a.map((r) => [r.sku, r.images]));
    const mine = new Set(b.map((r) => r.sku));
    const different = b.filter((r) => theirs.has(r.sku) && JSON.stringify(theirs.get(r.sku)) !== JSON.stringify(r.images))
      .map((r) => ({ sku: r.sku, josh: theirs.get(r.sku), commerce: r.images }));
    const missingInJosh = b.filter((r) => !theirs.has(r.sku)).map((r) => r.sku);
    const joshOnly = a.filter((r) => !mine.has(r.sku) && r.images.length).map((r) => r.sku);
    console.log(JSON.stringify({ josh: a.length, commerce: b.length, same: b.length - different.length - missingInJosh.length,
      different: different.length, missingInJosh: missingInJosh.length, joshOnly: joshOnly.length,
      sample: different.slice(0, 20), missingInJoshSample: missingInJosh.slice(0, 20), joshOnlySample: joshOnly.slice(0, 20) }, null, 2));
    if (different.length || missingInJosh.length) process.exitCode = 1;
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
