/**
 * Stage 4c check: does josh hold the category tree and brand names commerce has?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run category-parity
 *
 * Every column of every category (by id) and every brand's code / names (by id), both ways. Before the switch run it
 * after import-from-josh -- categories; after the switch it shows anything josh did not take from the snapshots.
 * Exit code 1 when anything differs.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { CATEGORY_COLUMNS } from '../modules/commerce/product-categories/category-rules';

type Row = Record<string, unknown> & { id: string };
const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));

function compare(josh: Row[], commerce: Row[], cols: readonly string[]) {
  const theirs = new Map(josh.map((r) => [r.id, r]));
  const mine = new Map(commerce.map((r) => [r.id, r]));
  const different: Array<{ id: string; column: string; josh: unknown; commerce: unknown }> = [];
  for (const [id, c] of mine) {
    const j = theirs.get(id);
    if (!j) continue;
    for (const col of cols) if (norm(j[col]) !== norm(c[col])) different.push({ id, column: col, josh: j[col] ?? null, commerce: c[col] ?? null });
  }
  return {
    josh: josh.length, commerce: commerce.length, different: new Set(different.map((d) => d.id)).size,
    onlyJosh: [...theirs.keys()].filter((id) => !mine.has(id)), onlyCommerce: [...mine.keys()].filter((id) => !theirs.has(id)),
    sample: different.slice(0, 20),
  };
}

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { console.error('JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const cols = CATEGORY_COLUMNS.join(', ');
    const brandCols = ['brand_code', 'brand_name_th', 'brand_name_en'] as const;
    const categories = compare(await josh.query(`SELECT ${cols} FROM product_category`), await commerce.query(`SELECT ${cols} FROM product_categories`), CATEGORY_COLUMNS);
    const brands = compare(await josh.query(`SELECT id, ${brandCols.join(', ')} FROM brand`), await commerce.query(`SELECT id, ${brandCols.join(', ')} FROM product_brands`), brandCols);
    console.log(JSON.stringify({ categories, brands }, null, 2));
    if ([categories, brands].some((r) => r.different || r.onlyJosh.length || r.onlyCommerce.length)) process.exitCode = 1;
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
