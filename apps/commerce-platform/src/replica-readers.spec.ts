import * as fs from 'fs';
import * as path from 'path';

/**
 * Stage 7 guard (docs/superpowers/plans/2026-10-09-stage7-cleanup.md, S7-1): josh's read replica is on its way out
 * (spec §1 — no replica, no bridge). Every file that still reads it is listed here with the stage-7 class and the
 * gate that lets it go. A new reader fails this test; a deleted one passes (subset check), so the list only shrinks.
 *
 *   A report reader (S5 gives it a *_SOURCE switch or a joshOnly text) · B copier / cutover checker at runtime ·
 *   C cutover CLI · W the connection itself
 *
 * Files marked "(S5)" / "(G5)" arrive when those branches merge; listed ahead so the merges don't break this test.
 */
const SRC = path.resolve(__dirname);

const REPLICA_READERS: Record<string, string> = {
  // W
  'modules/integration/connector/josh/josh-replica.ts': 'W — delete last (S7-7)',
  'modules/integration/connector/josh/josh.module.ts': 'W — provider, goes with JoshReplica',
  // A — report readers
  'modules/integration/connector/josh/bestsellers-offload.job.ts': 'A — BESTSELLERS_SOURCE=copies on prod',
  'modules/integration/connector/josh/restaurant-places.ts': 'A — RESTAURANTS_SOURCE=copies on prod',
  'modules/integration/connector/josh/josh-insights.ts': 'A — SALES_SOURCE=copies; traffic / order target group: owner',
  'modules/integration/connector/josh/josh-orders.ts': 'A — ORDERS_SOURCE=copies on prod',
  'modules/integration/connector/josh/josh-customers.ts': 'A — owner q1 (KYC / credit)',
  'modules/integration/connector/josh/josh-backoffice.ts': 'A — stays josh-admin (owner q3)',
  'modules/integration/connector/josh/josh-marketing-workflows.ts': 'A — MARKETING_WORKFLOWS_SOURCE=copies on prod',
  'modules/integration/connector/josh/josh-push-campaigns.ts': 'A — PUSH_CAMPAIGNS_SOURCE=copies on prod',
  'modules/integration/connector/josh/josh-products.ts': 'A — PRODUCTS_SOURCE=copies on prod',
  'modules/integration/connector/josh/josh-prices.ts': 'A — after G9 + owner (branch prices, quotations)',
  'modules/integration/connector/josh/josh-promotions.ts': 'A — G9 cutover; mechanics stay josh-admin',
  'modules/integration/connector/josh/winback/josh-winback.ts': 'A — WINBACK_REPORTS_SOURCE=copies on prod',
  'modules/integration/connector/josh/winback/josh-tables.ts': 'A — goes with josh-winback',
  'modules/integration/winback/winback-reports.ts': 'A (S5) — WINBACK_REPORTS_SOURCE=copies on prod',
  'modules/integration/winback/winback-reports.controller.ts': 'A (S5) — WINBACK_REPORTS_SOURCE=copies on prod',
  'modules/integration/growth/growth-data.service.ts': 'A — GROWTH_SOURCE=copies on prod',
  'modules/integration/growth/growth.service.ts': 'A — GROWTH_SOURCE=copies on prod',
  // B — copiers / cutover checkers
  'modules/integration/connector/josh/pricing/price-shadow.ts': 'B — 4a switched + shadow week',
  'modules/integration/connector/josh/pricing/staff-prices.ts': 'B — 4a switched (import); SKU lookup reads the copy',
  'modules/integration/connector/josh/jagota/jagota-shadow.ts': 'B — ERP gateway cutover',
  'modules/integration/connector/josh/jagota/jagota-sync-history.ts': 'B — jagota_sync snapshot trusted (S5-11)',
  'modules/integration/connector/josh/orders/josh-order-copy.ts': 'B — order.snapshot trusted',
  'modules/integration/connector/josh/josh-catalog-sync.service.ts': 'B — cron ON by default; ops turns it off first',
  'modules/integration/winback/winback-mirror.ts': 'B — WINBACK_OWNER=commerce on prod',
  // C — cutover CLIs (also read JOSH_DATABASE_URL themselves)
  'cli/import-from-josh.ts': 'C — last group switched + rollback window closed',
  'cli/price-parity.ts': 'C — 4a switched + post-switch parity week',
  'cli/content-parity.ts': 'C — 4b switched + post-switch parity week',
  'cli/category-parity.ts': 'C — 4c switched + post-switch parity week',
  'cli/master-parity.ts': 'C — 4d switched + post-switch parity week',
  'cli/image-parity.ts': 'C — 4e switched + post-switch parity week',
  'cli/ordering-parity.ts': 'C (G5) — 4f switched + post-switch parity week',
};

/** Only the connection and the CLIs read the variable; runtime code asks JoshReplica.configured. */
const READS_URL = new Set([
  'modules/integration/connector/josh/josh-replica.ts',
  ...Object.keys(REPLICA_READERS).filter((f) => f.startsWith('cli/')),
]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

const files = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join('/'), body: fs.readFileSync(f, 'utf8') }));

describe('josh replica readers (stage 7)', () => {
  it('no file outside the stage-7 list uses JoshReplica or JOSH_DATABASE_URL', () => {
    const uses = files.filter(({ body }) => /JoshReplica|josh-replica'|process\.env\.JOSH_DATABASE_URL/.test(body)).map((f) => f.rel);
    expect(uses.filter((f) => !(f in REPLICA_READERS))).toEqual([]);
  });

  it('only the connection and the cutover CLIs read JOSH_DATABASE_URL', () => {
    const reads = files.filter(({ body }) => /process\.env\.JOSH_DATABASE_URL/.test(body)).map((f) => f.rel);
    expect(reads.filter((f) => !READS_URL.has(f))).toEqual([]);
  });
});
