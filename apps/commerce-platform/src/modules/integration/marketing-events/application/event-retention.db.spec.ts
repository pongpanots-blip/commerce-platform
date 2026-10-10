import { DataSource } from 'typeorm';
import { EventRetention } from './event-retention';

const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('EventRetention (real DB)', () => {
  let db: DataSource;
  const D = 'n'.repeat(32);
  beforeAll(async () => { db = await new DataSource({ type: 'postgres', url }).initialize(); });
  afterAll(async () => {
    await db.query(`DELETE FROM marketing_events WHERE device_id = $1`, [D]);
    await db.query(`DELETE FROM marketing_event_daily WHERE name = 'retention_spec'`);
    await db.destroy();
  });

  it('rolls up yesterday (Bangkok) and runs every step without error, twice', async () => {
    const now = new Date();
    const yesterdayNoonBkk = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 7 * 3600_000 - 86_400_000 + 5 * 3600_000 - 7 * 3600_000);
    await db.query(`INSERT INTO marketing_events (schema_version, event_id, device_id, platform, source, environment, name, occurred_at)
      VALUES (1, 'e1000000-0000-4000-8000-000000000001', $1, 'web', 'shop_browser', 'development', 'retention_spec', $2)`, [D, yesterdayNoonBkk]);
    const job = new EventRetention(db);
    await job.run(now);
    await job.run(now);
    const rows = await db.query(`SELECT events, devices FROM marketing_event_daily WHERE name = 'retention_spec'`);
    expect(rows).toEqual([{ events: 1, devices: 1 }]);
  });
});
