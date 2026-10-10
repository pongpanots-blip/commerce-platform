import { DataSource } from 'typeorm';
import { deleteMarketingEventsForCustomer, linkDevice, withdrawConsent } from './device-links';

/** Opt-in: MARKETING_TEST_DATABASE_URL=postgres:///<migrated db> (never a shared / prod DB). */
const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('device links (real DB)', () => {
  let db: DataSource;
  const A = '0a000000-0000-4000-8000-00000000000a'; const B = '0b000000-0000-4000-8000-00000000000b';
  const D = 'd'.repeat(32);
  const at = (h: number) => new Date(Date.now() - (10 - h) * 3600_000);
  const event = (n: number, h: number) => db.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name, occurred_at)
    VALUES (1, $1, $2, 'web', 'shop_browser', 'development', 'view_item', $3)`, [`e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, D, at(h)]);
  const owners = async () => (await db.query(`SELECT event_id, attributed_user_id AS u, attribution AS a, name FROM marketing_events WHERE device_id = $1 ORDER BY occurred_at`, [D]))
    .map((r: { u: string | null; a: string | null }) => [r.u, r.a]);

  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url }).initialize();
    for (const u of [A, B]) await db.query(`INSERT INTO josh_customers (id, data, source_version) VALUES ($1, '{"pdpa_consent": true}', 1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [u]);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM marketing_events WHERE device_id = $1`, [D]);
    await db.query(`DELETE FROM marketing_device_links WHERE device_id = $1`, [D]);
    await db.query(`DELETE FROM josh_customers WHERE id = ANY($1::uuid[])`, [[A, B]]);
    await db.destroy();
  });

  it('guest → A → B; a late, out-of-order link reattributes only its range; facts never change', async () => {
    await event(1, 1); await event(2, 3); await event(3, 6); await event(4, 8);
    const facts = await db.query(`SELECT event_id, name, occurred_at, device_id FROM marketing_events WHERE device_id = $1 ORDER BY occurred_at`, [D]);
    await db.transaction((m) => linkDevice(m, { deviceId: D, userId: B, platform: 'web', linkedAt: at(7) }));
    expect(await owners()).toEqual([[B, 'device_link'], [B, 'device_link'], [B, 'device_link'], [B, 'device_link']]);
    await db.transaction((m) => linkDevice(m, { deviceId: D, userId: A, platform: 'web', linkedAt: at(2) })); // arrives late
    expect(await owners()).toEqual([[A, 'device_link'], [A, 'device_link'], [A, 'device_link'], [B, 'device_link']]);
    expect(await db.query(`SELECT event_id, name, occurred_at, device_id FROM marketing_events WHERE device_id = $1 ORDER BY occurred_at`, [D])).toEqual(facts);
  });

  it('withdrawn consent deletes the user\'s events; PDPA delete removes links too', async () => {
    await db.transaction((m) => withdrawConsent(m, A));
    expect((await owners()).filter(([u]) => u === A)).toEqual([]);
    await db.transaction((m) => deleteMarketingEventsForCustomer(m, B));
    expect(await db.query(`SELECT 1 FROM marketing_device_links WHERE user_id = $1`, [B])).toEqual([]);
  });
});
