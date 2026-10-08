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

/** DataSource/runner is supplied by the caller; importing this module never connects to a DB. */
export async function runStaffBackfill(db: DataSource, apply = false) {
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
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--json'].includes(arg))) throw new Error('Usage: winback-staff-backfill [--apply] [--json]');
  const { AppDataSource } = await import('../data-source');
  const apply = args.includes('--apply');
  if (apply) assertBackfillOwnership(); // Before opening a connection.
  await AppDataSource.initialize();
  try {
    const report = await runStaffBackfill(AppDataSource, apply);
    console.log(JSON.stringify(report, null, args.includes('--json') ? undefined : 2));
  } finally { await AppDataSource.destroy(); }
}
if (require.main === module) main().catch(() => {
  // Query errors can contain raw emails/connection credentials. Never print driver errors.
  console.error('Backfill refused or failed. --apply requires WINBACK_OWNER=commerce and COMMERCE_OWNS_SALES_REPS=true; inspect masked plans and resolve identity/record conflicts before retrying.');
  process.exitCode = 1;
});
