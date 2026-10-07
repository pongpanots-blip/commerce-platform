/** Local signed shadow copy only; no Josh database connection. */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { ProductPromotionRulesService } from '../modules/commerce/product-promotion-rules/product-promotion-rules.service';
async function main() {
  const db = await AppDataSource.initialize();
  try {
    const different = await new ProductPromotionRulesService(db, { publish: async () => undefined }).parity();
    console.log(JSON.stringify({ different: different.length, sample: different.slice(0, 20) }, null, 2));
    if (different.length) process.exitCode = 1;
  } finally { await db.destroy(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
