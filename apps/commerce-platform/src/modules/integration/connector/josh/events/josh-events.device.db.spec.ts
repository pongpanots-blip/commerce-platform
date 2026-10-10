import { DataSource } from 'typeorm';
import { JoshEventsService } from './josh-events.service';
import { JoshCustomerCopy } from './josh-customer-copy.entity';

/** Opt-in: MARKETING_TEST_DATABASE_URL=postgres:///<migrated db>. device.snapshot end to end on a real database. */
const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('JoshEventsService device.snapshot (real DB)', () => {
  let db: DataSource; let svc: JoshEventsService; let wf: string;
  const U = '0d000000-0000-4000-8000-00000000000d'; // customer who never consented
  const DEV = 'g'.repeat(10) + 'guest-device';
  const ROW = '0d000000-0000-4000-8000-0000000000d1';
  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url, entities: [JoshCustomerCopy] }).initialize();
    svc = new JoshEventsService(db);
    await db.query(`INSERT INTO josh_customers (id, data, source_version) VALUES ($1, '{"pdpa_consent": false}', 1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [U]);
    [{ id: wf }] = await db.query(`INSERT INTO marketing_workflows (name, trigger_type, status) VALUES ('device-db-spec', 'event', 'active') RETURNING id`);
  });
  afterAll(async () => {
    await db.query(`DELETE FROM marketing_workflows WHERE id = $1`, [wf]);
    await db.query(`DELETE FROM marketing_device_links WHERE device_id = $1`, [DEV]);
    await db.query(`DELETE FROM josh_user_devices WHERE id = $1`, [ROW]);
    await db.query(`DELETE FROM josh_customers WHERE id = $1`, [U]);
    await db.destroy();
  });

  it('a device linked to a customer without consent ends its guest journeys instead of pushing on', async () => {
    const [{ id: guest }] = await db.query(`INSERT INTO marketing_workflow_enrollments (workflow_id, user_id, device_id, occurrence_key, status, current_step_id)
      VALUES ($1, NULL, $2, 'ev-guest', 'running', 's1') RETURNING id`, [wf, DEV]);
    expect(await svc.apply({ type: 'device.snapshot', aggregateId: ROW, version: String(Date.now()), occurredAt: new Date().toISOString(),
      data: { id: ROW, user_id: U, individual_id: DEV, platform: 'web', last_seen_at: new Date().toISOString() } })).toBe('applied');
    const [row] = await db.query(`SELECT status, end_reason, user_id FROM marketing_workflow_enrollments WHERE id = $1`, [guest]);
    expect(row).toEqual({ status: 'skipped', end_reason: 'consent_missing', user_id: null });
  });
});
