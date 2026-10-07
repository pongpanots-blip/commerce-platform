import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { JoshStaffAccessService } from './josh-staff-access.service';

/*
 * Stage 6: commerce writes josh staff access and tells josh through the outbox. Opt-in, migrated scratch DB:
 *   STAFF_TEST_DATABASE_URL='postgres://box@/commerce_s6_test?host=/var/run/postgresql' \
 *     npx jest -c apps/commerce-platform/jest.config.cts --runInBand josh-staff-access.service.db
 */
const url = process.env.STAFF_TEST_DATABASE_URL;
const ID = '00000000-0000-4000-8000-000000000611';
const actor = { userId: '00000000-0000-4000-8000-000000000612', email: 'admin@jagota.co.th' };

(url ? describe : describe.skip)('JoshStaffAccessService against a database', () => {
  let db: DataSource;
  let svc: JoshStaffAccessService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE type = 'staff.access' AND aggregate_id = $1`, [ID]);
    await db.query(`DELETE FROM audit_logs WHERE entity_type = 'josh_staff' AND entity_id = $1`, [ID]);
    await db.query(`DELETE FROM josh_staff_access WHERE id = $1`, [ID]);
    await db.query(`DELETE FROM josh_staff WHERE id = $1`, [ID]);
  };

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_STAFF = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage], synchronize: false }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [JoshStaffAccessService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(JoshStaffAccessService);
    await clean();
    await db.query(`INSERT INTO josh_staff (id, email, first_name, role, user_type, is_active, token_version)
      VALUES ($1, 'cs@josh.test', 'Cee', 'cs', 'internal', true, 2)`, [ID]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_STAFF; });

  it('change role, then disable + sign out: each saved, audited and published; pending until josh echoes it', async () => {
    expect(await svc.set(ID, { role: 'manager' }, actor)).toMatchObject({ role: 'manager', isActive: true, pending: true });
    const after = await svc.set(ID, { isActive: false, revokeSessions: true }, actor);
    expect(after).toMatchObject({ role: 'manager', isActive: false, pending: true, updatedBy: 'admin@jagota.co.th' });

    const events = await db.query(`SELECT payload FROM outbox_messages WHERE type = 'staff.access' AND aggregate_id = $1 ORDER BY created_at`, [ID]);
    expect(events.map((e: { payload: { role: string; isActive: boolean; minTokenVersion: number } }) => [e.payload.role, e.payload.isActive, e.payload.minTokenVersion]))
      .toEqual([['manager', true, 0], ['manager', false, 3]]);
    expect(Date.parse(events[1].payload.version)).toBeGreaterThan(Date.parse(events[0].payload.version));
    expect(await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'josh_staff' AND entity_id = $1`, [ID])).toEqual([{ n: 2 }]);

    // josh applied it and its trigger sent staff.snapshot back
    await db.query(`UPDATE josh_staff SET role = 'manager', is_active = false, token_version = 3 WHERE id = $1`, [ID]);
    expect((await svc.list()).find((s) => s.id === ID)).toMatchObject({ role: 'manager', isActive: false, pending: false });
  });

  it('a customer or unknown id is a 404', async () => {
    await expect(svc.set('00000000-0000-4000-8000-0000000006ff', { isActive: false }, actor)).rejects.toThrow('ไม่พบพนักงานใน josh');
  });
});
