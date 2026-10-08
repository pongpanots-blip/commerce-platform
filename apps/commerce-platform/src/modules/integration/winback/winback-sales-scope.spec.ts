import { opportunityVisibility, normalizeActor, ownerFilterError } from './opportunity-meta.helpers';
import { OpportunityService } from './opportunity.service';
import { WinbackService } from './winback.service';
import { WinbackReportsController } from './winback-reports.controller';

const actor = { id: 'commerce-id', ids: ['commerce-id', 'josh-id'], isManager: false };
function builder() {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['leftJoin', 'select', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'limit', 'skip', 'take']) qb[method] = jest.fn(() => qb);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  return qb;
}

it('all linked ids are own, unassigned stays visible, another rep stays hidden', () => {
  const visibility = opportunityVisibility(actor);
  expect(visibility.sql).toContain('COALESCE(m.sales_user_id, a.assigned_sales_user_id)');
  expect(visibility.sql).toContain('IS NULL OR');
  expect(visibility.params).toEqual({ visibleOwners: actor.ids });
  expect(visibility.allows('commerce-id')).toBe(true);
  expect(visibility.allows(' JOSH-ID ')).toBe(true);
  expect(visibility.allows(null)).toBe(true);
  expect(visibility.allows('other-id')).toBe(false);
  expect(ownerFilterError(actor, { owner_sales_user_id: 'josh-id' })).toBeNull();
  expect(ownerFilterError(actor, { owner_sales_user_id: 'other-id' })).toMatchObject({ status: 403 });
  expect(normalizeActor({ ...actor, ids: [' JOSH-ID ', 'josh-id'] }).ids).toEqual(['josh-id']);
  const empty = opportunityVisibility({ id: '', ids: [], isManager: false });
  expect(empty.sql).toMatch(/IS NULL$/);
  expect(empty.allows('someone')).toBe(false);
});

it('opportunity list scopes before its candidate cap and pagination', async () => {
  const qb = builder();
  const opportunities = new OpportunityService({ createQueryBuilder: () => qb } as never, {} as never, {} as never, {} as never);
  const result = await opportunities.list(actor, { page: 1, limit: 20 });
  expect(result.items).toEqual([]);
  expect(qb.andWhere).toHaveBeenCalledWith(opportunityVisibility(actor).sql, { visibleOwners: actor.ids });
  expect(qb.andWhere.mock.invocationCallOrder[0]).toBeLessThan(qb.limit.mock.invocationCallOrder[0]);
});

it('commerce my-pool scopes both rows and count to own + unassigned, without changing existing app calls', async () => {
  const qb = builder();
  const winback = new WinbackService({ createQueryBuilder: () => qb } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  await winback.findPool({ page: 1, limit: 20 }, actor, true);
  expect(qb.leftJoin).toHaveBeenCalledWith(expect.anything(), 'm', expect.stringContaining('CAST(a.restaurant_place_id AS text)'), { poolMetaKind: 'opportunity_meta' });
  expect(qb.andWhere).toHaveBeenCalledWith(opportunityVisibility(actor).sql, { visibleOwners: actor.ids });
  expect(qb.andWhere.mock.invocationCallOrder[0]).toBeLessThan(qb.getManyAndCount.mock.invocationCallOrder[0]);
  qb.andWhere.mockClear();
  await winback.findPool({ page: 1, limit: 20 }, actor);
  expect(qb.andWhere).not.toHaveBeenCalled();
});

it('my report routes pass linked ids and never delegate to team reports', async () => {
  const identity = { repIdsFor: jest.fn().mockResolvedValue(actor.ids) };
  const opportunities = { list: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0 } }) };
  const pool = { findPool: jest.fn().mockResolvedValue({ data: [], meta: { total: 0 } }) };
  const c = new WinbackReportsController({ available: false } as never, identity as never, opportunities as never, pool as never);
  const req = { staff: { userId: actor.id, email: 'rep@example.test', role: 'sale' as const } };
  await c.myOpportunities(req, { page: 1, limit: 20 });
  expect(opportunities.list).toHaveBeenCalledWith(actor, { page: 1, limit: 20 });
  await c.myPool(req, { page: 1, limit: 20 });
  expect(pool.findPool).toHaveBeenCalledWith({ page: 1, limit: 20 }, actor, true);
});
