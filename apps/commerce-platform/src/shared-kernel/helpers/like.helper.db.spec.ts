import { DataSource } from 'typeorm';
import { containsPattern } from './like.helper';

/*
 * The escaped pattern against real Postgres (josh replica and commerce copies are both Postgres). Opt-in, any scratch DB;
 * only a TEMP table is used, so nothing is left behind:
 *   LIKE_TEST_DATABASE_URL=postgres:///scratch npx jest -c apps/commerce-platform/jest.config.cts --runInBand like.helper.db
 */
const url = process.env.LIKE_TEST_DATABASE_URL;

(url ? describe : describe.skip)('containsPattern + ILIKE ... ESCAPE \'\\\' on Postgres', () => {
  let db: DataSource;
  const NAMES = ['acme', '100% organic', 'a_b', 'axb', 'a%b', 'a\\b', 'ab'];

  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url, extra: { max: 1 } }).initialize();
    await db.query(`CREATE TEMP TABLE like_probe (name text)`);
    for (const name of NAMES) await db.query(`INSERT INTO like_probe VALUES ($1)`, [name]);
  });
  afterAll(async () => { await db?.destroy(); });

  const find = async (search: string) =>
    ((await db.query(`SELECT name FROM like_probe WHERE name ILIKE $1 ESCAPE '\\'`, [containsPattern(search)])) as { name: string }[]).map((r) => r.name).sort();

  it.each([
    ['%%', []],
    ['%', ['100% organic', 'a%b']],
    ['_', ['a_b']],
    ['a%b', ['a%b']],
    ['a_b', ['a_b']],
    ['a\\b', ['a\\b']],
    ['ACME', ['acme']],
  ])('%s matches literally', async (search, expected) => {
    expect(await find(search)).toEqual([...expected].sort());
  });

  it('without escaping, the same searches match far more (the bug)', async () => {
    const raw = async (search: string) => ((await db.query(`SELECT count(*)::int AS n FROM like_probe WHERE name ILIKE $1`, [`%${search}%`])) as { n: number }[])[0].n;
    expect(await raw('%%')).toBe(NAMES.length);
    expect(await raw('a_b')).toBe(4); // a_b, axb, a%b, a\b
  });
});
