import { DataSource } from 'typeorm';
import type { EventDefinition, EventRule } from '@cp/marketing-workflow';
import { compileRule } from './event-rule';

/** Opt-in: MARKETING_TEST_DATABASE_URL=postgres:///<migrated db>. The compiled SQL must run and count like the in-memory rules. */
const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('compileRule (real DB)', () => {
  let db: DataSource;
  const U = '0c000000-0000-4000-8000-00000000000c';
  const D = 'r'.repeat(32);
  const def: EventDefinition = { name: 'rule_spec_event', label: '', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
    attributes: [{ key: 'sku', type: 'string', label: '' }, { key: 'price', type: 'number', label: '' }, { key: 'gift', type: 'boolean', label: '' }, { key: 'on', type: 'date', label: '' }] };
  const refs = { catalog: new Map([[def.name, def]]), segments: new Map<string, EventRule>() };
  const ev = (n: number, hoursAgo: number, attributes: object) => db.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name,
      attributes, occurred_at, attributed_user_id, attribution) VALUES (1, $1, $2, 'web', 'shop_browser', 'development', 'rule_spec_event', $3::jsonb, now() - make_interval(hours => $4), $5, 'device_link')`,
    [`ec000000-0000-4000-8000-${String(n).padStart(12, '0')}`, D, JSON.stringify(attributes), hoursAgo, U]);
  const run = async (rule: EventRule) => {
    const params: unknown[] = [U];
    const [r] = await db.query(`SELECT (${compileRule(rule, refs, '$1::uuid', params)}) AS ok`, params);
    return r.ok;
  };
  const leaf = (over: object): EventRule => ({ kind: 'event', name: 'rule_spec_event', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [], ...over }) as EventRule;

  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url }).initialize();
    await ev(1, 2, { sku: 'A-1', price: 300, gift: true, on: new Date(Date.now() - 86_400_000).toISOString() });
    await ev(2, 30, { sku: 'B-2', price: 400, gift: false });
    await ev(3, 24 * 10, { sku: 'C-3', price: 1000 });
  });
  afterAll(async () => { await db.query(`DELETE FROM marketing_events WHERE device_id = $1`, [D]); await db.destroy(); });

  it('counts, sums, windows and every filter type run as SQL', async () => {
    expect(await run(leaf({ op: 'eq', value: 2 }))).toBe(true); // 10-day-old event outside 7 days
    expect(await run(leaf({ measure: { sum: 'price' }, op: 'eq', value: 700 }))).toBe(true);
    expect(await run(leaf({ filters: [{ key: 'sku', op: 'in', value: ['B-2', 'X'] }], op: 'eq', value: 1 }))).toBe(true);
    expect(await run(leaf({ filters: [{ key: 'sku', op: 'contains', value: 'A' }, { key: 'price', op: 'gt', value: 250 }, { key: 'gift', op: 'eq', value: true },
      { key: 'on', op: 'within_last_days', value: 2 }], op: 'eq', value: 1 }))).toBe(true);
    expect(await run(leaf({ filters: [{ key: 'sku', op: 'neq', value: 'A-1' }], op: 'eq', value: 1 }))).toBe(true); // missing attr never matches
    expect(await run(leaf({ window: { from: new Date(Date.now() - 12 * 86_400_000).toISOString(), to: new Date(Date.now() - 5 * 86_400_000).toISOString() }, op: 'eq', value: 1 }))).toBe(true);
    expect(await run({ op: 'AND', children: [leaf({}), leaf({ op: 'lte', value: 0 })] })).toBe(false);
  });
});
