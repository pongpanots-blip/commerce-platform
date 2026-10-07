import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { SalesRepsService } from './sales-reps.service';

/*
 * Stage 2b: commerce assigns company sales reps and tells josh through the outbox. Opt-in, migrated scratch DB:
 *   CUSTOMERS_TEST_DATABASE_URL=postgres:///commerce_2b_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand sales-reps.service.db
 */
const url = process.env.CUSTOMERS_TEST_DATABASE_URL;
const CO = '00000000-0000-4000-8000-0000000002b1', REP = '00000000-0000-4000-8000-0000000002b2', USER = '00000000-0000-4000-8000-0000000002b3';

(url ? describe : describe.skip)('SalesRepsService against a database', () => {
  let db: DataSource;
  let svc: SalesRepsService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE type = 'company.sales_rep' AND aggregate_id = $1`, [CO]);
    await db.query(`DELETE FROM company_sales_reps WHERE id = $1`, [CO]);
    await db.query(`DELETE FROM josh_customers WHERE id = ANY($1::uuid[])`, [[REP, USER]]);
  };

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_SALES_REPS = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage], synchronize: false }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [SalesRepsService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(SalesRepsService);
    await clean();
    await db.query(`INSERT INTO josh_customers (id, data) VALUES ($1, $2), ($3, $4)`,
      [REP, { id: REP, role: 'sales' }, USER, { id: USER, role: 'customer', company_id: CO }]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_SALES_REPS; });

  it('assigns, then clears, each time publishing company.sales_rep in the same transaction', async () => {
    await svc.assign(CO, REP);
    expect(await db.query(`SELECT assigned_sales_user_id FROM company_sales_reps WHERE id = $1`, [CO])).toEqual([{ assigned_sales_user_id: REP }]);
    await svc.assign(CO, null);
    const events = await db.query(`SELECT payload FROM outbox_messages WHERE type = 'company.sales_rep' AND aggregate_id = $1 ORDER BY created_at`, [CO]);
    expect(events.map((e: { payload: { salesUserId: string | null } }) => e.payload.salesUserId)).toEqual([REP, null]);
    expect(Date.parse(events[1].payload.assignedAt)).toBeGreaterThan(Date.parse(events[0].payload.assignedAt) - 1);
  });

  it('a company josh never sent is a 404', async () => {
    await expect(svc.assign('00000000-0000-4000-8000-0000000002ff', REP)).rejects.toThrow('ไม่พบบริษัท');
  });
});
