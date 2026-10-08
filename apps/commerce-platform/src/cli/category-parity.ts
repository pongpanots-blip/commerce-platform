/**
 * Stage 4c check: does josh hold the category tree and brand names commerce has?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run category-parity
 *
 * Every column of every category (by id) and every brand's code / names (by id), both ways. Before the switch run it
 * after import-from-josh -- categories; after the switch it shows anything josh did not take from the snapshots.
 * The ALL row's created_at / updated_at are not compared: commerce's seed cannot share josh's clock, and those two
 * columns are not the tree. Exit code 1 when anything differs. The JSON diff is written to stdout before exit.
 */
import 'reflect-metadata';
import { writeSync } from 'fs';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { ALL_CATEGORY_ID, CATEGORY_COLUMNS } from '../modules/commerce/product-categories/category-rules';

type Row = Record<string, unknown> & { id: string };
const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));
const AUDIT = new Set(['created_at', 'updated_at']);

export function compareRows(josh: Row[], commerce: Row[], cols: readonly string[]) {
  const theirs = new Map(josh.map((r) => [r.id, r]));
  const mine = new Map(commerce.map((r) => [r.id, r]));
  const different: Array<{ id: string; column: string; josh: unknown; commerce: unknown }> = [];
  for (const [id, c] of mine) {
    const j = theirs.get(id);
    if (!j) continue;
    for (const col of cols) {
      if (id === ALL_CATEGORY_ID && AUDIT.has(col)) continue;
      if (norm(j[col]) !== norm(c[col])) different.push({ id, column: col, josh: j[col] ?? null, commerce: c[col] ?? null });
    }
  }
  return {
    josh: josh.length, commerce: commerce.length, different: new Set(different.map((d) => d.id)).size,
    onlyJosh: [...theirs.keys()].filter((id) => !mine.has(id)), onlyCommerce: [...mine.keys()].filter((id) => !theirs.has(id)),
    sample: different.slice(0, 20),
  };
}

function emit(fd: number, text: string) {
  writeSync(fd, text.endsWith('\n') ? text : `${text}\n`);
}

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { emit(2, 'JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  let code = 0;
  try {
    const cols = CATEGORY_COLUMNS.join(', ');
    const brandCols = ['brand_code', 'brand_name_th', 'brand_name_en'] as const;
    const categories = compareRows(await josh.query(`SELECT ${cols} FROM product_category`), await commerce.query(`SELECT ${cols} FROM product_categories`), CATEGORY_COLUMNS);
    const brands = compareRows(await josh.query(`SELECT id, ${brandCols.join(', ')} FROM brand`), await commerce.query(`SELECT id, ${brandCols.join(', ')} FROM product_brands`), brandCols);
    emit(1, JSON.stringify({ categories, brands }, null, 2));
    code = [categories, brands].some((r) => r.different || r.onlyJosh.length || r.onlyCommerce.length) ? 1 : 0;
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
  process.exit(code);
}

const invoked = process.argv[1] != null && /category-parity\.(ts|js)$/.test(process.argv[1]);
if (invoked) main().catch((error) => { emit(2, error instanceof Error ? (error.stack ?? error.message) : String(error)); process.exit(1); });
