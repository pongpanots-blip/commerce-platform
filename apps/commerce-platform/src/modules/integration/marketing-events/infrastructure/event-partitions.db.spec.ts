import { DataSource } from 'typeorm';
import { ensurePartition, monthStart, partitionName } from './event-partitions';

const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('event partitions (real DB)', () => {
  let db: DataSource;
  beforeAll(async () => { db = await new DataSource({ type: 'postgres', url }).initialize(); });
  afterAll(() => db.destroy());

  it('moves rows that fell into the default partition into a new month', async () => {
    const start = monthStart(new Date(), 6);
    await db.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name, occurred_at)
      VALUES (1, 'f0000000-0000-4000-8000-000000000001', $2, 'web', 'shop_browser', 'development', 'view_item', $1)`, [new Date(start.getTime() + 3600_000), 'p'.repeat(32)]);
    expect(await ensurePartition(db, start)).toBe(true);
    const [r] = await db.query(`SELECT tableoid::regclass::text AS part FROM marketing_events WHERE event_id = 'f0000000-0000-4000-8000-000000000001'`);
    expect(r.part).toBe(partitionName(start));
    expect(await ensurePartition(db, start)).toBe(false);
    await db.query(`DROP TABLE ${partitionName(start)}`);
  });
});
