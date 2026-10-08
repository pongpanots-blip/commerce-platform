import { DataSource } from 'typeorm';
import { importStaff, STAFF_FROM_JOSH_SQL } from './import-from-josh';

/** Stage 2b runs `import-from-josh -- sales-reps` before the 2c staff backfill. The sales app signs in against josh_staff. */
describe('sales-reps import also loads josh_staff', () => {
  it('uses the stage 2c staff predicate and will not clobber an event-owned row', () => {
    expect(STAFF_FROM_JOSH_SQL).toContain("r.user_type IS DISTINCT FROM 'customer'");
    expect(STAFF_FROM_JOSH_SQL).toContain('LEFT JOIN app_roles r ON r.code = u.role');
  });
});

const commerceUrl = process.env.CUTOVER_TEST_DATABASE_URL;
const joshUrl = process.env.CUTOVER_JOSH_DATABASE_URL;

(commerceUrl && joshUrl ? describe : describe.skip)('importStaff against postgres', () => {
  const REP = '00000000-0000-4000-8000-0000000002b2';
  const OWNED = '00000000-0000-4000-8000-0000000002b4';
  const GONE = '00000000-0000-4000-8000-0000000002b5';
  const CUST = '00000000-0000-4000-8000-0000000002b6';
  let josh: DataSource;
  let commerce: DataSource;

  beforeAll(async () => {
    josh = await new DataSource({ type: 'postgres', url: joshUrl }).initialize();
    commerce = await new DataSource({ type: 'postgres', url: commerceUrl }).initialize();
    await josh.query(`CREATE TABLE IF NOT EXISTS app_roles (code varchar PRIMARY KEY, user_type varchar)`);
    await josh.query(`CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY, email varchar, first_name varchar, last_name varchar, role varchar,
      is_active boolean, token_version int, company_id uuid, created_at timestamptz, last_app_login_at timestamptz)`);
    await josh.query(`TRUNCATE users, app_roles`);
    await josh.query(`INSERT INTO app_roles (code, user_type) VALUES ('sales', 'internal'), ('customer', 'customer')`);
    await josh.query(`INSERT INTO users (id, email, first_name, role, is_active, token_version) VALUES
      ($1, 'rep@josh.test', 'Rep', 'sales', true, 4),
      ($2, 'owned@josh.test', 'Owned', 'sales', true, 1),
      ($3, 'gone@josh.test', 'Gone', 'sales', true, 1),
      ($4, 'cust@josh.test', 'Cust', 'customer', true, 1)`, [REP, OWNED, GONE, CUST]);
    await commerce.query(`DELETE FROM josh_reference_tombstones WHERE id = ANY($1)`, [[REP, OWNED, GONE, CUST]]);
    await commerce.query(`DELETE FROM josh_staff WHERE id = ANY($1)`, [[REP, OWNED, GONE, CUST]]);
    await commerce.query(`INSERT INTO josh_staff (id, email, role, user_type, source_version) VALUES ($1, 'keep-me', 'sales', 'internal', 9)`, [OWNED]);
    await commerce.query(`INSERT INTO josh_reference_tombstones (tbl, id, source_version) VALUES ('josh_staff', $1, 3)`, [GONE]);
  });

  afterAll(async () => {
    await commerce?.query(`DELETE FROM josh_reference_tombstones WHERE id = ANY($1)`, [[REP, OWNED, GONE, CUST]]);
    await commerce?.query(`DELETE FROM josh_staff WHERE id = ANY($1)`, [[REP, OWNED, GONE, CUST]]);
    await josh?.destroy();
    await commerce?.destroy();
  });

  it('inserts a rep at version 0, refreshes that row, and leaves event-owned and deleted rows', async () => {
    await importStaff(josh, commerce);
    const [rep] = await commerce.query(`SELECT email, token_version, source_version::text AS v FROM josh_staff WHERE id = $1`, [REP]);
    expect(rep).toEqual({ email: 'rep@josh.test', token_version: 4, v: '0' });
    await josh.query(`UPDATE users SET email = 'rep2@josh.test', token_version = 5 WHERE id = $1`, [REP]);
    await importStaff(josh, commerce);
    const [again] = await commerce.query(`SELECT email, token_version, source_version::text AS v FROM josh_staff WHERE id = $1`, [REP]);
    expect(again).toEqual({ email: 'rep2@josh.test', token_version: 5, v: '0' });
    const [owned] = await commerce.query(`SELECT email, source_version::text AS v FROM josh_staff WHERE id = $1`, [OWNED]);
    expect(owned).toEqual({ email: 'keep-me', v: '9' });
    expect(await commerce.query(`SELECT 1 FROM josh_staff WHERE id = $1`, [GONE])).toEqual([]);
    expect(await commerce.query(`SELECT 1 FROM josh_staff WHERE id = $1`, [CUST])).toEqual([]);
  });
});
