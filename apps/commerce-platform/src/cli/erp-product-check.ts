/**
 * Look a list of SKUs up in the ERP (jagota node API, the Magento phase-two product read) and store the result in
 * product_erp_checks — e.g. the P-12 sheet "SKUs in ERP but missing from the data sent to JOSH".
 *
 *   npm run erp-product-check -- P-12 skus.txt      (or `-` to read the SKUs from stdin)
 *
 * SKUs: one per line or comma separated. API base: ERP_NODE_API_URL, else JAGOTA_NODEAPI_BASE_URL (the gateway's).
 * Re-running the same check code overwrites its rows. Prints a count per verdict. On prod: ops/scripts/erp-product-check.
 */
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { AppDataSource } from '../data-source';

type ErpProduct = { PRODUCT_CODE: string; STATUS?: string; IS_ENABLE?: string } & Record<string, unknown>;
export type Verdict = 'not_found' | 'enabled' | 'hidden' | 'inactive';

/** IS_ENABLE is '1' only for STATUS 'N' with SHOW_IN_WEB 'Y'; 'hidden' = active in ERP but not shown on the web. */
export function verdictOf(p: ErpProduct | undefined): Verdict {
  if (!p) return 'not_found';
  if (p.IS_ENABLE === '1') return 'enabled';
  return p.STATUS === 'N' ? 'hidden' : 'inactive';
}

const BATCH = 40; // SKUs travel comma-separated in the URL path

async function fetchBatch(base: string, skus: string[]): Promise<ErpProduct[]> {
  const url = `${base}/products-migration-to-magento/products-migration-to-magento/${skus.map(encodeURIComponent).join(',')}/get-product-for-magento-phase-two-batch`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { error: boolean; message?: string; result?: Array<{ product?: ErpProduct } | null> };
      if (body.error) throw new Error(body.message ?? 'ERP API error');
      return (body.result ?? []).flatMap((r) => (r?.product ? [r.product] : []));
    } catch (e) {
      if (attempt === 3) throw new Error(`${skus[0]}…: ${(e as Error).message}`);
    }
  }
}

async function main() {
  const [code, file] = process.argv.slice(2);
  if (!code || !file) { console.error('usage: npm run erp-product-check -- <check-code> <skus.txt | ->'); process.exit(1); }
  const base = (process.env.ERP_NODE_API_URL || process.env.JAGOTA_NODEAPI_BASE_URL || 'https://nodeapi-staging.jagota.com').replace(/\/$/, '');
  const skus = [...new Set(readFileSync(file === '-' ? 0 : file, 'utf8').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean))];

  const found = new Map<string, ErpProduct>();
  for (let i = 0; i < skus.length; i += BATCH) for (const p of await fetchBatch(base, skus.slice(i, i + BATCH))) found.set(p.PRODUCT_CODE, p);

  const rows = skus.map((sku) => {
    const p = found.get(sku);
    return { sku, verdict: verdictOf(p), status: p?.STATUS ?? null, enable: p?.IS_ENABLE ?? null, erp: p ?? null };
  });
  const db = await AppDataSource.initialize();
  try {
    await db.query(
      `INSERT INTO product_erp_checks (check_code, sku, verdict, erp_status, is_enable, erp, source)
       SELECT $1, r.sku, r.verdict, r.status, r.enable, r.erp, $2 FROM jsonb_to_recordset($3::jsonb)
         AS r(sku text, verdict text, status text, enable text, erp jsonb)
       ON CONFLICT (check_code, sku) DO UPDATE SET verdict = EXCLUDED.verdict, erp_status = EXCLUDED.erp_status,
         is_enable = EXCLUDED.is_enable, erp = EXCLUDED.erp, source = EXCLUDED.source, checked_at = now()`,
      [code, base, JSON.stringify(rows)],
    );
  } finally {
    await db.destroy();
  }
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  console.log(JSON.stringify({ checkCode: code, source: base, skus: skus.length, ...counts }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
