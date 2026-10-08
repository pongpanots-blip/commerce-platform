import { DataSource } from 'typeorm';
import { planStaffAccounts, StaffRow } from './winback-staff-plan.helpers';
export { planStaffAccounts } from './winback-staff-plan.helpers';

/** Read-only planning: account creation is deliberately outside this CLI. No passwords are generated. */
export async function runStaffAccountsPlan(db: DataSource) {
  return db.transaction('REPEATABLE READ', async manager => {
    await manager.query('SET TRANSACTION READ ONLY');
    const josh: StaffRow[] = await manager.query('SELECT id, email, role, is_active, user_type FROM josh_staff');
    const commerce: StaffRow[] = await manager.query('SELECT id, email, role, status FROM users');
    return { mode: 'dry-run', ...planStaffAccounts(josh, commerce) };
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--json')) throw new Error('Usage: winback-staff-accounts-plan [--json] (dry-run only)');
  const { AppDataSource } = await import('../data-source');
  await AppDataSource.initialize();
  try { console.log(JSON.stringify(await runStaffAccountsPlan(AppDataSource), null, args.includes('--json') ? undefined : 2)); }
  finally { await AppDataSource.destroy(); }
}
if (require.main === module) main().catch(() => {
  console.error('Account plan failed. This tool is dry-run only; no accounts or passwords were created.');
  process.exitCode = 1;
});
