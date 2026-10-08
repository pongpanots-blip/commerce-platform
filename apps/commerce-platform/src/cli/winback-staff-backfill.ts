import { DataSource, QueryRunner } from 'typeorm';
import { ownsSalesReps } from '../modules/integration/customers/sales-reps.service';
import { winbackOwnedByCommerce } from '../modules/integration/winback/shared/winback.config';
import { CompanySalesRepAssigned } from '../modules/integration/customers/sales-reps.service';
import { EventEmitterBus } from '../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../shared-kernel/infrastructure/outbox.entity';
import {
  backfillCandidates, classifyStaff, planStaffRewrites, STAFF_COLUMNS,
  StaffLink, StaffRow, StaffSnapshot, StaffTable,
} from './winback-staff-plan.helpers';
export { classifyStaff, maskEmail, planStaffRewrites } from './winback-staff-plan.helpers';

export const BACKFILL_WARNING = 'Rewritten winback rows will be mirrored to Josh with commerce ids; Josh copies cannot resolve names when ids differ.';
export function assertBackfillOwnership(): void {
  if (!winbackOwnedByCommerce() || !ownsSalesReps()) {
    throw new Error('--apply requires WINBACK_OWNER=commerce and COMMERCE_OWNS_SALES_REPS=true');
  }
}

/** The reviewed plan an --apply must match exactly: new links and the sum of rowsChanged (ambiguous must be 0). */
export interface BackfillExpectation { links: number; rows: number }
export class BackfillPlanMismatch extends Error {
  constructor(readonly actual: { links: number; rows: number; ambiguous: number }, readonly expected: BackfillExpectation) {
    super(`Planned links=${actual.links} rows=${actual.rows} ambiguous=${actual.ambiguous} do not match the reviewed links=${expected.links} rows=${expected.rows} ambiguous=0; rolled back`);
  }
}
const EXPECT_ARG = /^--expect-(links|rows)=(\d+)$/;
/** --expect-links=N and --expect-rows=M: both required with --apply, not allowed without it. */
export function parseBackfillArgs(args: string[]): { apply: boolean; json: boolean; expect?: BackfillExpectation } {
  const usage = 'Usage: winback-staff-backfill [--json] [--apply --expect-links=N --expect-rows=M]';
  const expect: Partial<BackfillExpectation> = {};
  for (const arg of args) {
    const m = EXPECT_ARG.exec(arg);
    if (m) { if (expect[m[1] as keyof BackfillExpectation] !== undefined) throw new Error(usage); expect[m[1] as keyof BackfillExpectation] = Number(m[2]); }
    else if (!['--apply', '--json'].includes(arg)) throw new Error(usage);
  }
  const apply = args.includes('--apply');
  const hasExpect = expect.links !== undefined || expect.rows !== undefined;
  if (apply !== hasExpect || (apply && (expect.links === undefined || expect.rows === undefined))) throw new Error(usage);
  return { apply, json: args.includes('--json'), expect: apply ? expect as BackfillExpectation : undefined };
}

/** DataSource/runner is supplied by the caller; importing this module never connects to a DB.
 *  With `expect`, an apply refuses inside the locked transaction (before any write, never committed) unless the plan is exactly that. */
export async function runStaffBackfill(db: DataSource, apply = false, expect?: BackfillExpectation) {
  if (apply) assertBackfillOwnership();
  const runner: QueryRunner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction('REPEATABLE READ');
    // Serialize the apply snapshot with assignments, app records and staff/link edits. No partial cutover.
    if (apply) await runner.query(`LOCK TABLE users, josh_staff, winback_staff_links, ${Object.keys(STAFF_COLUMNS).join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
    else await runner.query('SET TRANSACTION READ ONLY');
    const josh: StaffRow[] = await runner.query('SELECT id, email, role, is_active, user_type FROM josh_staff');
    const commerce: StaffRow[] = await runner.query('SELECT id, email, role, status FROM users');
    const existing: StaffLink[] = await runner.query('SELECT josh_user_id, commerce_user_id FROM winback_staff_links');
    const snapshot: StaffSnapshot = {};
    for (const table of Object.keys(STAFF_COLUMNS) as StaffTable[]) {
      const extra = table === 'winback_app_record' ? ', kind, payload, record_key' : table === 'winback_sales_target' ? ', period_month' : '';
      snapshot[table] = await runner.query(`SELECT id, ${STAFF_COLUMNS[table].join(', ')}${extra} FROM ${table}`);
    }
    const classification = classifyStaff(backfillCandidates(josh, snapshot), commerce);
    const links = [...existing];
    const newLinks: StaffLink[] = [];
    for (const link of classification.matched) {
      const sameJosh = existing.find(row => row.josh_user_id === link.josh_user_id);
      const sameCommerce = existing.find(row => row.commerce_user_id === link.commerce_user_id);
      if ((sameJosh && sameJosh.commerce_user_id !== link.commerce_user_id) || (sameCommerce && sameCommerce.josh_user_id !== link.josh_user_id)) {
        throw new Error('Existing staff link conflicts with email match; resolve links manually');
      }
      if (!sameJosh) { links.push(link); newLinks.push(link); }
    }
    const rewrites = planStaffRewrites(snapshot, links);
    const rowsChanged = Object.fromEntries(Object.keys(STAFF_COLUMNS).map(table => [table, rewrites.filter(row => row.table === table).length]));
    if (apply && expect) {
      const actual = { links: newLinks.length, rows: Object.values(rowsChanged).reduce((sum, n) => sum + n, 0), ambiguous: classification.ambiguous.length };
      // Still inside the locked transaction: throwing here reaches rollbackTransaction below, nothing is written or committed.
      if (actual.links !== expect.links || actual.rows !== expect.rows || actual.ambiguous !== 0) throw new BackfillPlanMismatch(actual, expect);
    }
    if (apply) {
      for (const link of newLinks) {
        await runner.query(`INSERT INTO winback_staff_links (josh_user_id, commerce_user_id)
          VALUES ($1, $2) ON CONFLICT (josh_user_id) DO NOTHING`, [link.josh_user_id, link.commerce_user_id]);
      }
      const events = new EventEmitterBus(runner.manager.getRepository(OutboxMessage));
      for (const rewrite of rewrites) {
        const fields = Object.keys(rewrite.changes);
        // Payload was transformed only at the allowlisted paths; table lock prevents overwriting concurrent edits.
        await runner.query(`UPDATE ${rewrite.table} SET ${fields.map((field, i) => `${field} = $${i + 2}${field === 'payload' ? '::jsonb' : ''}`).join(', ')} WHERE id = $1`,
          [rewrite.id, ...fields.map(field => field === 'payload' ? JSON.stringify(rewrite.changes[field]) : rewrite.changes[field])]);
        if (rewrite.table === 'company_sales_reps') {
          const assignedAt = new Date().toISOString();
          await runner.query('UPDATE company_sales_reps SET updated_at = $2 WHERE id = $1', [rewrite.id, assignedAt]);
          await events.publish(new CompanySalesRepAssigned({ companyId: rewrite.id, salesUserId: rewrite.changes.assigned_sales_user_id as string, assignedAt }), runner.manager);
        }
      }
    }
    await runner.commitTransaction();
    return { mode: apply ? 'apply' : 'dry-run', warning: BACKFILL_WARNING, classification,
      counts: { matched: classification.matched.length, unmatched: classification.unmatched.length, ambiguous: classification.ambiguous.length, ineligible: classification.ineligible.length, links: newLinks.length },
      rowsChanged, rewrites: rewrites.map(row => ({ table: row.table, id: row.id, fields: Object.keys(row.changes) })) };
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally { await runner.release(); }
}

async function main() {
  const { apply, json, expect } = parseBackfillArgs(process.argv.slice(2));
  const { AppDataSource } = await import('../data-source');
  if (apply) assertBackfillOwnership(); // Before opening a connection.
  await AppDataSource.initialize();
  try {
    const report = await runStaffBackfill(AppDataSource, apply, expect);
    console.log(JSON.stringify(report, null, json ? undefined : 2));
  } finally { await AppDataSource.destroy(); }
}
if (require.main === module) main().catch((error) => {
  // Query errors can contain raw emails/connection credentials. Never print driver errors; our own usage/plan errors carry counts only.
  if (error instanceof BackfillPlanMismatch || /^Usage: /.test(String(error?.message))) console.error(error.message);
  console.error('Backfill refused or failed. --apply requires WINBACK_OWNER=commerce and COMMERCE_OWNS_SALES_REPS=true; inspect masked plans and resolve identity/record conflicts before retrying.');
  process.exitCode = 1;
});
