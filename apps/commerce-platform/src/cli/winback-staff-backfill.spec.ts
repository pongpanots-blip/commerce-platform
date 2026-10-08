import { backfillCandidates, classifyStaff, maskEmail, planStaffAccounts, planStaffRewrites, STAFF_COLUMNS, StaffRow, StaffSnapshot } from './winback-staff-plan.helpers';
import { assertBackfillOwnership, BackfillPlanMismatch, parseBackfillArgs, runStaffBackfill } from './winback-staff-backfill';
import { runStaffAccountsPlan } from './winback-staff-accounts-plan';

const J = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222';
const rep = (id = J, email = ' Rep@Example.test ', role = 'sale'): StaffRow => ({ id, email, role, is_active: true, user_type: 'internal' });
const links = [{ josh_user_id: J, commerce_user_id: C }];
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

it('classifies unique case-insensitive trimmed email matches, missing and ambiguous identities', () => {
  const result = classifyStaff([rep(), rep('missing', 'no@example.test'), rep('a', 'dup@example.test'), rep('b', ' DUP@example.test '), rep('j-many', 'many@example.test')],
    [rep(C, 'rep@example.TEST'), rep('c-many-1', 'many@example.test'), rep('c-many-2', ' MANY@example.test ')]);
  expect(result).toEqual({ matched: links, unmatched: ['missing'], ambiguous: [
    { joshIds: ['a', 'b'], commerceIds: [] }, { joshIds: ['j-many'], commerceIds: ['c-many-1', 'c-many-2'] },
  ], ineligible: [] });
  expect(JSON.stringify(result)).not.toContain('@');
});
it('never links a rep to a developer, disabled or non-sales commerce account with the same email', () => {
  const dev = { ...rep('c-dev', 'dev@example.test', 'developer'), status: 'active' };
  const off = { ...rep('c-off', 'off@example.test', 'sale'), status: 'disabled' };
  const mkt = { ...rep('c-mkt', 'mkt@example.test', 'marketing'), status: 'active' };
  const mgr = { ...rep('c-mgr', 'boss@example.test', 'sale_manager'), status: 'active' };
  const result = classifyStaff([rep('j-dev', 'DEV@example.test'), rep('j-off', 'off@example.test'), rep('j-mkt', 'mkt@example.test'), rep('j-mgr', 'boss@example.test', 'manager')], [dev, off, mkt, mgr]);
  expect(result).toEqual({ matched: [{ josh_user_id: 'j-mgr', commerce_user_id: 'c-mgr' }], unmatched: [], ambiguous: [], ineligible: ['j-dev', 'j-off', 'j-mkt'] });
  const accounts = planStaffAccounts([rep('j-dev', 'dev@example.test'), rep('j-new', 'new@example.test')], [dev]);
  expect(accounts.accounts.map(a => a.joshId)).toEqual(['j-new']);
  expect(accounts.ineligible).toEqual(['j-dev']);
  expect(JSON.stringify(accounts)).not.toMatch(/dev@|new@/);
});
it.each([
  [' Alice@Domain.com ', 'al***@d***.com'], ['ab@domain.com', 'a***@d***.com'], ['a@d.com', '***@***.com'],
  ['long@localhost', 'lo***@l***'], ['', '***'], ['broken', '***'], ['a@@b', '***'],
])('masks %s as %s', (email, expected) => expect(maskEmail(email)).toBe(expected));

it('rewrites every staff column, exact JSON paths and user natural keys while leaving free text/other ids intact', () => {
  const snapshot: StaffSnapshot = {};
  for (const table of Object.keys(STAFF_COLUMNS) as Array<keyof typeof STAFF_COLUMNS>) {
    snapshot[table] = [{ id: `${table}-id`, ...Object.fromEntries(STAFF_COLUMNS[table].map(field => [field, J])) }];
  }
  snapshot.winback_sales_target![0].period_month = '2026-10';
  snapshot.winback_app_record = [
    { id: 'collab', kind: 'opportunity_collab', sales_user_id: J, created_by: J, payload: {
      requests: [{ id: J, requester_id: J, recipient_id: J.toUpperCase(), resolved_by_id: J, from_owner_id: J, reason: J }],
      messages: [{ id: J, author_id: J, recipient_id: J, text: J }],
    } },
    { id: 'log', kind: 'opp_collab_log', payload: { actor_id: J, target_user_id: J, note: J, changes: { owner: { from: J, to: J }, purpose: { from: J } } } },
    { id: 'team', kind: 'team', payload: { sales_user_ids: [J, 'other'], name: J } },
    { id: 'joint', kind: 'joint_visit', payload: { organizer_id: J, participant_id: J } },
    { id: 'quote', kind: 'quote', payload: { events: [{ actor_id: J, label: J }], versions: [{ note: J }] } },
    { id: 'dispatch', kind: 'quote_dispatch', payload: { actor_id: J } },
    { id: 'report', kind: 'daily_report', record_key: `${J}|2026-10-08`, payload: { reviewed_by: J } },
    { id: 'draft', kind: 'activity_draft', record_key: `${J}|${J}`, payload: { note: J } },
    { id: 'saved', kind: 'saved_place', record_key: `${J}|${J}`, payload: { place_id: J } },
    { id: 'discovery', kind: 'discovery_query', record_key: J, payload: { search: J } },
    { id: 'meta', kind: 'opportunity_meta', sales_user_id: J, payload: { owner_sales_user_id: J } },
  ];
  const updates = planStaffRewrites(snapshot, links);
  for (const table of Object.keys(STAFF_COLUMNS)) expect(updates.some(row => row.table === table)).toBe(true);
  const update = (id: string) => updates.find(row => row.id === id)!.changes;
  expect(update('collab')).toMatchObject({ sales_user_id: C, created_by: C, payload: {
    requests: [{ id: J, requester_id: C, recipient_id: C, resolved_by_id: C, from_owner_id: C, reason: J }],
    messages: [{ id: J, author_id: C, recipient_id: C, text: J }],
  } });
  expect(update('log')).toMatchObject({ payload: { actor_id: C, target_user_id: C, note: J, changes: { owner: { from: C, to: C }, purpose: { from: J } } } });
  expect(update('team')).toMatchObject({ payload: { sales_user_ids: [C, 'other'], name: J } });
  expect(update('quote')).toMatchObject({ payload: { events: [{ actor_id: C, label: J }], versions: [{ note: J }] } });
  expect(update('report').record_key).toBe(`${C}|2026-10-08`);
  expect(update('draft').record_key).toBe(`${C}|${J}`);
  expect(update('saved').record_key).toBe(`${C}|${J}`);
  expect(update('discovery').record_key).toBe(C);
  // Apply the pure plan to a copy: the second pass must be empty, including JSON and natural keys.
  const migrated: StaffSnapshot = {};
  for (const table of Object.keys(STAFF_COLUMNS) as Array<keyof typeof STAFF_COLUMNS>) migrated[table] = snapshot[table]?.map(row => ({ ...row, ...updates.find(update => update.table === table && update.id === row.id)?.changes }));
  expect(planStaffRewrites(migrated, links)).toEqual([]);
  expect(snapshot.winback_app_record[0].sales_user_id).toBe(J);
});
it('same-id links and nonmatching ids are no-ops', () => {
  expect(planStaffRewrites({ winback_activity: [{ id: 'a', sales_user_id: J }] }, [{ josh_user_id: J, commerce_user_id: J }])).toEqual([]);
});
it('fails before writes for overlapping mappings or natural-key collisions', () => {
  expect(() => planStaffRewrites({}, [...links, { josh_user_id: C, commerce_user_id: 'other' }])).toThrow('Overlapping');
  expect(() => planStaffRewrites({ winback_app_record: [
    { id: 'a', kind: 'daily_report', record_key: `${J}|2026-10-08` }, { id: 'b', kind: 'daily_report', record_key: `${C}|2026-10-08` },
  ] }, links)).toThrow('collide');
  expect(() => planStaffRewrites({ winback_sales_target: [
    { id: 'a', sales_user_id: J, period_month: '2026-10' }, { id: 'b', sales_user_id: C, period_month: '2026-10' },
  ] }, links)).toThrow('collide');
});
it('includes only active internal reps, plus admins referenced in identity fields', () => {
  expect(backfillCandidates([rep(), rep('admin-owner', 'admin@example.test', 'admin'), rep('admin-unused', 'unused@example.test', 'platform_admin'),
    { ...rep('disabled'), is_active: false }, { ...rep('customer'), user_type: 'customer' }],
    { winback_stage_history: [{ id: 'a', changed_by: 'admin-owner' }] }).map(row => row.id)).toEqual([J, 'admin-owner']);
});
it.each([
  [undefined, undefined], ['commerce', 'false'], ['josh', 'true'], ['commerce', undefined],
])('apply refuses owner=%s sales-reps=%s without even constructing a runner', async (owner, sales) => {
  if (owner === undefined) delete process.env.WINBACK_OWNER; else process.env.WINBACK_OWNER = owner;
  if (sales === undefined) delete process.env.COMMERCE_OWNS_SALES_REPS; else process.env.COMMERCE_OWNS_SALES_REPS = sales;
  const db = { createQueryRunner: jest.fn() };
  expect(() => assertBackfillOwnership()).toThrow('--apply requires');
  await expect(runStaffBackfill(db as never, true)).rejects.toThrow('--apply requires');
  expect(db.createQueryRunner).not.toHaveBeenCalled();
});

function memoryDb(joshStaff: StaffRow[] = [rep()]) {
  const stored: StaffSnapshot = { winback_app_record: [{ id: 'a', kind: 'quote', sales_user_id: J, payload: { events: [{ actor_id: J }] } }] };
  const savedLinks: typeof links = [];
  const runner = {
    connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(), isTransactionActive: true,
    manager: { getRepository: jest.fn(() => ({})) },
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT id, email') && sql.includes('FROM josh_staff')) return joshStaff;
      if (sql.startsWith('SELECT id, email') && sql.includes('FROM users')) return [rep(C, 'rep@example.test')];
      if (sql.includes('SELECT josh_user_id')) return savedLinks;
      if (sql.startsWith('SELECT id,')) {
        const table = sql.split(' FROM ')[1] as keyof typeof STAFF_COLUMNS;
        return stored[table] ?? [];
      }
      if (sql.startsWith('INSERT INTO winback_staff_links')) savedLinks.push({ josh_user_id: params[0] as string, commerce_user_id: params[1] as string });
      if (sql.startsWith('UPDATE winback_app_record')) {
        const fields = sql.split(' SET ')[1].split(' WHERE ')[0].split(', ').map(set => set.split(' = ')[0]);
        const row = stored.winback_app_record!.find(row => row.id === params[0])!;
        fields.forEach((field, index) => row[field] = field === 'payload' ? JSON.parse(params[index + 1] as string) : params[index + 1]);
      }
      return [];
    }),
  };
  return { runner, db: { createQueryRunner: () => runner }, stored, savedLinks };
}
it('default dry-run produces safe reports and no mutations', async () => {
  const { db, runner } = memoryDb();
  const report = await runStaffBackfill(db as never);
  expect(report.mode).toBe('dry-run');
  expect(report.rowsChanged.winback_app_record).toBe(1);
  expect(report.warning).toContain('cannot resolve names');
  expect(runner.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
  expect(JSON.stringify(report)).not.toContain('@');
  expect(JSON.stringify(report)).not.toContain('events');
});
it('apply links and rewrites in one transaction, and a second run writes zero rows', async () => {
  process.env.WINBACK_OWNER = 'commerce'; process.env.COMMERCE_OWNS_SALES_REPS = 'true';
  const { db, runner } = memoryDb();
  const report = await runStaffBackfill(db as never, true);
  expect(report.counts.links).toBe(1);
  expect(runner.startTransaction).toHaveBeenCalledTimes(1);
  expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  expect(runner.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))![0]).toContain('payload = $3::jsonb');
  runner.query.mockClear();
  const second = await runStaffBackfill(db as never, true);
  expect(second.counts.links).toBe(0);
  expect(second.rewrites).toEqual([]);
  expect(runner.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
});

describe('apply pinned to the reviewed plan (--expect-links / --expect-rows)', () => {
  beforeEach(() => { process.env.WINBACK_OWNER = 'commerce'; process.env.COMMERCE_OWNS_SALES_REPS = 'true'; });
  const writes = (runner: ReturnType<typeof memoryDb>['runner']) => runner.query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql));

  it.each([
    [{ links: 2, rows: 37 }], [{ links: 1, rows: 37 }], [{ links: 2, rows: 1 }], [{ links: 0, rows: 0 }],
  ])('a plan of 1 link / 1 row against %j throws inside the locked transaction: no write, rolled back, never committed', async (want) => {
    const { db, runner, savedLinks, stored } = memoryDb();
    const error = await runStaffBackfill(db as never, true, want).catch(e => e);
    expect(error).toBeInstanceOf(BackfillPlanMismatch);
    expect(error.message).toContain('links=1 rows=1 ambiguous=0');
    expect(error.message).not.toContain('@');
    const sqls = runner.query.mock.calls.map(([sql]) => sql as string);
    expect(sqls[0]).toMatch(/^LOCK TABLE users, josh_staff, winback_staff_links/); // the check runs under the apply lock
    expect(writes(runner)).toEqual([]);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(savedLinks).toEqual([]);
    expect(stored.winback_app_record![0].sales_user_id).toBe(J);
  });
  it('an ambiguous identity refuses even when links/rows match', async () => {
    const { db, runner } = memoryDb([rep(), rep('dup1', 'dup@example.test'), rep('dup2', ' DUP@example.test ')]);
    await expect(runStaffBackfill(db as never, true, { links: 1, rows: 1 })).rejects.toThrow('ambiguous=1');
    expect(writes(runner)).toEqual([]);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
  it('an exact match writes and commits once', async () => {
    const { db, runner, savedLinks } = memoryDb();
    const report = await runStaffBackfill(db as never, true, { links: 1, rows: 1 });
    expect(report.counts.links).toBe(1);
    expect(savedLinks).toEqual(links);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });
  it('a dry run never writes', async () => {
    const { db, runner } = memoryDb();
    await runStaffBackfill(db as never, false);
    expect(writes(runner)).toEqual([]);
  });
  it.each([
    [[], { apply: false, json: false, expect: undefined }],
    [['--json'], { apply: false, json: true, expect: undefined }],
    [['--json', '--apply', '--expect-links=2', '--expect-rows=37'], { apply: true, json: true, expect: { links: 2, rows: 37 } }],
  ])('parses %j', (args, parsed) => expect(parseBackfillArgs(args)).toEqual(parsed));
  it.each([
    [['--apply']], [['--apply', '--expect-links=2']], [['--apply', '--expect-rows=37']], [['--expect-links=2', '--expect-rows=37']],
    [['--apply', '--expect-links=2', '--expect-rows=37', '--expect-rows=1']], [['--apply', '--expect-links=-1', '--expect-rows=37']],
    [['--apply', '--expect-links=2', '--expect-rows=3.7']], [['--force']],
  ])('rejects %j (an --apply must carry both expectations)', (args) => expect(() => parseBackfillArgs(args)).toThrow('Usage:'));
});

it('A3 proposes masked sales/manager accounts, reuses ids, reports taken ids and skips matched/ambiguous/disabled reps', () => {
  const result = planStaffAccounts([rep(), rep('manager', 'boss@example.test', 'manager'), rep('matched', 'exists@example.test', 'sales'),
    rep('dup1', 'dup@example.test'), rep('dup2', ' DUP@example.test '), { ...rep('disabled'), is_active: false }],
    [rep('manager', 'different@example.test'), rep('existing', ' EXISTS@example.test ')]);
  expect(result.accounts).toEqual([
    { joshId: J, email: 're***@e***.test', role: 'sale', proposedId: J, idDecision: 'id reused' },
    { joshId: 'manager', email: 'bo***@e***.test', role: 'sales_manager', proposedId: null, idDecision: 'id taken → new uuid + backfill rewrite' },
  ]);
  expect(result.ambiguous).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(/password|hash|boss@|rep@/i);
});
it('A3 uses a read-only transaction and emits masked output only', async () => {
  const manager = { query: jest.fn(async (sql: string) => sql.includes('FROM josh_staff') ? [rep()] : []) };
  const db = { transaction: jest.fn(async (_isolation: string, fn: (manager: unknown) => unknown) => fn(manager)) };
  const report = await runStaffAccountsPlan(db as never);
  expect(report.mode).toBe('dry-run');
  expect(manager.query).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
  expect(manager.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
  expect(JSON.stringify(report)).not.toContain('rep@example');
});
