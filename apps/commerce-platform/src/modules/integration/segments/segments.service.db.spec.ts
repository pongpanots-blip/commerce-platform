import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { SegmentDefinitionCompiler } from './segment-definition.compiler';
import { Segment, SegmentMember } from './segment.entity';
import { SegmentsService } from './segments.service';

/*
 * Stage 2a: commerce freezes segments from its copies and tells josh through the outbox. Opt-in, migrated scratch DB:
 *   CUSTOMERS_TEST_DATABASE_URL=postgres:///commerce_stage2_test npx jest -c apps/commerce-platform/jest.config.cts segments.service.db
 * The outbox relay is not started: events stay in outbox_messages for the assertions.
 */
const url = process.env.CUSTOMERS_TEST_DATABASE_URL;
const C1 = '00000000-0000-4000-8000-0000000005c1', C2 = '00000000-0000-4000-8000-0000000005c2', C3 = '00000000-0000-4000-8000-0000000005c3';

(url ? describe : describe.skip)('SegmentsService against a database', () => {
  let db: DataSource;
  let svc: SegmentsService;
  const slugs = ['t2a-big', 't2a-custype', 't2a-manual'];
  const outbox = async (aggregateIds: string[]) => (await db.query(
    `SELECT type, payload FROM outbox_messages WHERE type LIKE 'segment.%' AND aggregate_id = ANY($1::uuid[]) ORDER BY created_at, id`, [aggregateIds]));
  const clean = async () => {
    const ids = (await db.query(`SELECT id FROM segments WHERE slug = ANY($1)`, [slugs])).map((r: { id: string }) => r.id);
    await db.query(`DELETE FROM outbox_messages WHERE type LIKE 'segment.%' AND aggregate_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM segments WHERE slug = ANY($1)`, [slugs]);
    await db.query(`DELETE FROM customer_metrics WHERE user_id = ANY($1::uuid[])`, [[C1, C2, C3]]);
    await db.query(`DELETE FROM josh_customers WHERE id = ANY($1::uuid[])`, [[C1, C2, C3]]);
  };

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_SEGMENTS = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [Segment, SegmentMember, OutboxMessage], synchronize: false }),
        TypeOrmModule.forFeature([OutboxMessage])],
      providers: [SegmentsService, SegmentDefinitionCompiler, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(SegmentsService);
    await clean();
    const customer = (id: string, custype: string, tier: string) => db.query(`INSERT INTO josh_customers (id, data) VALUES ($1, $2)`,
      [id, { id, custype, role: 'customer', created_at: '2026-01-01T00:00:00Z', tier_slug: tier, company_id: null }]);
    await customer(C1, 'HORECA', 'gold');
    await customer(C2, 'HORECA', 'silver');
    await customer(C3, 'RETAIL', 'silver');
    await db.query(`INSERT INTO customer_metrics (user_id, lifetime_spend, lifetime_order_count) VALUES ($1, 5000, 3), ($2, 200, 1)`, [C1, C2]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_SEGMENTS; });

  it('a definition segment freezes from the copies; the segment event goes before its members', async () => {
    const { data } = await svc.create({ slug: 't2a-big', name: 'Big spenders', rule_type: 'min_order_value',
      definition: { op: 'AND', children: [{ field: 'lifetime_spend', operator: '>=', value: 1000 }] } } as never);
    const ours = (await db.query(`SELECT user_id FROM segment_members WHERE segment_id = $1`, [data!.id])).map((r: { user_id: string }) => r.user_id);
    expect(ours.filter((id: string) => [C1, C2, C3].includes(id))).toEqual([C1]);
    expect(data).toMatchObject({ member_count: ours.length, frozen_at: expect.any(Date) });
    const events = await outbox([data!.id]);
    expect(events.map((e: { type: string }) => e.type)).toEqual(['segment.upserted', 'segment.members']);
    expect(events[0].payload).toMatchObject({ id: data!.id, slug: 't2a-big', member_count: ours.length });
    expect(events[1].payload).toMatchObject({ segmentId: data!.id, part: 1, parts: 1, frozenAt: new Date(data!.frozen_at!).toISOString() });
    expect(events[1].payload.userIds).toContain(C1);
    expect(await svc.countNow(data!.id)).toBe(ours.length);
  });

  it('a live rule type is not frozen and sends no members', async () => {
    const { data } = await svc.create({ slug: 't2a-custype', name: 'HORECA', rule_type: 'custype', rule_config: { custypes: ['HORECA'] } } as never);
    expect(data).toMatchObject({ frozen_at: null, member_count: null });
    expect((await outbox([data!.id])).map((e: { type: string }) => e.type)).toEqual(['segment.upserted']);
  });

  it('a manual list keeps known customers only; the lock and delete follow josh', async () => {
    const { data } = await svc.create({ slug: 't2a-manual', name: 'Manual', rule_type: 'manual_user_list',
      rule_config: { user_ids: [C3, C3, 'not-a-uuid', '00000000-0000-4000-8000-00000000dead'] } } as never);
    expect(data!.member_count).toBe(1);
    await expect(svc.update(data!.id, { rule_config: { user_ids: [C1] } } as never)).rejects.toThrow('ถูกล็อก');
    await svc.update(data!.id, { name: 'Manual v2' } as never);
    await svc.remove(data!.id);
    expect(await db.query(`SELECT 1 FROM segment_members WHERE segment_id = $1`, [data!.id])).toEqual([]);
    expect((await outbox([data!.id])).map((e: { type: string }) => e.type)).toEqual(['segment.upserted', 'segment.members', 'segment.upserted', 'segment.deleted']);
  });

  it('writes are refused until commerce owns segments', async () => {
    process.env.COMMERCE_OWNS_SEGMENTS = 'false';
    try {
      await expect(svc.create({ slug: 't2a-off', name: 'x', rule_type: 'member' } as never)).rejects.toThrow('COMMERCE_OWNS_SEGMENTS');
    } finally { process.env.COMMERCE_OWNS_SEGMENTS = 'true'; }
  });
});
