import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { OutboxMessage } from '../shared-kernel/infrastructure/outbox.entity';
import { BackfillPlanMismatch, runStaffBackfill } from './winback-staff-backfill';

/*
 * The --apply plan guard against a real Postgres transaction. Opt-in, any scratch DB: every table is a session TEMP
 * table on a single pooled connection, so nothing outside this session is read or written and nothing persists.
 *   WINBACK_BACKFILL_TEST_DATABASE_URL='postgres://box@/postgres?host=/var/run/postgresql' \
 *     npx jest -c apps/commerce-platform/jest.config.cts --runInBand winback-staff-backfill.db
 */
const url = process.env.WINBACK_BACKFILL_TEST_DATABASE_URL;
const J = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222';
const ACTIVITY = ['a1', 'a2', 'a3'].map((_, i) => `33333333-3333-4333-8333-33333333333${i}`);

(url ? describe : describe.skip)('winback-staff backfill --apply plan guard against Postgres', () => {
  let db: DataSource;
  const saved = { ...process.env };
  const state = async () => ({
    links: await db.query('SELECT josh_user_id, commerce_user_id FROM winback_staff_links'),
    owners: (await db.query('SELECT sales_user_id FROM winback_activity ORDER BY id')).map((r: { sales_user_id: string }) => r.sales_user_id),
  });

  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', url, entities: [OutboxMessage], synchronize: false, extra: { max: 1 } });
    await db.initialize();
    for (const ddl of [
      'CREATE TEMP TABLE users (id uuid PRIMARY KEY, email text, role text, status text)',
      'CREATE TEMP TABLE josh_staff (id uuid PRIMARY KEY, email text, role text, is_active boolean, user_type text)',
      'CREATE TEMP TABLE winback_staff_links (josh_user_id uuid PRIMARY KEY, commerce_user_id uuid UNIQUE NOT NULL)',
      'CREATE TEMP TABLE company_sales_reps (id uuid PRIMARY KEY, assigned_sales_user_id uuid, updated_at timestamptz)',
      'CREATE TEMP TABLE winback_account (id uuid PRIMARY KEY, assigned_sales_user_id uuid, created_by_sales_user_id uuid)',
      'CREATE TEMP TABLE winback_activity (id uuid PRIMARY KEY, sales_user_id uuid)',
      'CREATE TEMP TABLE winback_sales_target (id uuid PRIMARY KEY, sales_user_id uuid, created_by uuid, period_month text)',
      'CREATE TEMP TABLE winback_app_record (id uuid PRIMARY KEY, sales_user_id uuid, created_by uuid, kind text, payload jsonb, record_key text)',
      'CREATE TEMP TABLE winback_stage_history (id uuid PRIMARY KEY, changed_by uuid)',
      'CREATE TEMP TABLE winback_meeting_ack (id uuid PRIMARY KEY, discussed_by uuid)',
    ]) await db.query(ddl);
    await db.query(`INSERT INTO josh_staff VALUES ($1, 'rep@example.test', 'sale', true, 'internal')`, [J]);
    await db.query(`INSERT INTO users VALUES ($1, ' REP@example.test ', 'sale', 'active')`, [C]);
    for (const id of ACTIVITY) await db.query('INSERT INTO winback_activity VALUES ($1, $2)', [id, J]);
  });
  beforeEach(() => { process.env.WINBACK_OWNER = 'commerce'; process.env.COMMERCE_OWNS_SALES_REPS = 'true'; });
  afterAll(async () => { process.env = { ...saved }; await db?.destroy(); });

  it('a plan (1 link / 3 rows) that differs from the expectation throws in the locked transaction and leaves the DB untouched', async () => {
    for (const want of [{ links: 2, rows: 37 }, { links: 1, rows: 2 }, { links: 0, rows: 3 }]) {
      const error = await runStaffBackfill(db, true, want).catch(e => e);
      expect(error).toBeInstanceOf(BackfillPlanMismatch);
      expect(error.message).toContain('links=1 rows=3 ambiguous=0');
      expect(await state()).toEqual({ links: [], owners: [J, J, J] });
      // Rolled back: the session is idle again, not stuck in an aborted/open transaction.
      expect(await db.query('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
    }
  });

  it('the exact plan commits; a rerun plans 0/0 and refuses the old expectation without writing', async () => {
    const report = await runStaffBackfill(db, true, { links: 1, rows: 3 });
    expect(report.counts.links).toBe(1);
    expect(await state()).toEqual({ links: [{ josh_user_id: J, commerce_user_id: C }], owners: [C, C, C] });
    await expect(runStaffBackfill(db, true, { links: 1, rows: 3 })).rejects.toThrow('links=0 rows=0 ambiguous=0');
    expect((await runStaffBackfill(db, false)).counts.links).toBe(0);
    expect(await state()).toEqual({ links: [{ josh_user_id: J, commerce_user_id: C }], owners: [C, C, C] });
  });
});
