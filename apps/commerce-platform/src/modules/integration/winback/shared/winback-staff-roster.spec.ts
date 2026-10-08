import { listStaffRoster, staffRosterSql } from './winback-staff-roster';
import { LeadService } from '../lead.service';
import { SalesRepsService } from '../../customers/sales-reps.service';

const saved = process.env.WINBACK_ACCEPT_JOSH_JWT;
afterEach(() => { if (saved === undefined) delete process.env.WINBACK_ACCEPT_JOSH_JWT; else process.env.WINBACK_ACCEPT_JOSH_JWT = saved; });
it('unions active commerce reps and active unlinked internal Josh reps with safe names', async () => {
  delete process.env.WINBACK_ACCEPT_JOSH_JWT;
  const db = { query: jest.fn().mockResolvedValue([{ id: 'commerce', name: 'Staff commerce', role: 'manager' }, { id: 'josh', name: 'Legacy', role: 'sale' }]) };
  expect(await listStaffRoster(db, ['sale', 'sales', 'manager'])).toHaveLength(2);
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain('UNION ALL');
  expect(sql).toContain('SELECT DISTINCT ON (id)');
  expect(sql).toContain('ORDER BY id, source_order');
  expect(sql).toContain("status = 'active'");
  expect(sql).toContain("'sale', 'sales_manager', 'sale_manager'");
  expect(sql).toContain("THEN 'manager'");
  expect(sql).toContain('NOT EXISTS (SELECT 1 FROM winback_staff_links');
  expect(sql).toContain("is_active AND user_type = 'internal'");
  expect(sql).toContain("'Staff ' || left(id::text, 8)");
  expect(sql).not.toMatch(/email|phone/);
  expect(params).toEqual([['sale', 'sales', 'manager']]);
  const leads = new LeadService({} as never, {} as never, db as never, {} as never, {} as never, {} as never);
  expect(await leads.listSalesUsers()).toEqual(await leads.listStaffNames(['sale', 'sales', 'manager']));
  expect(await new SalesRepsService(db as never, {} as never).list()).toEqual([{ id: 'commerce', name: 'Staff commerce' }, { id: 'josh', name: 'Legacy' }]);
});
it('legacy-off excludes Josh entirely; named directory permits commerce admins', async () => {
  process.env.WINBACK_ACCEPT_JOSH_JWT = ' Off ';
  const sql = staffRosterSql(['sale', 'manager', 'admin', 'platform_admin']);
  expect(sql).not.toContain('josh_staff');
  expect(sql).not.toContain('UNION');
  expect(sql).toContain("'admin'");
});
it('does not query for an empty directory role list', async () => {
  const db = { query: jest.fn() };
  expect(await listStaffRoster(db, [])).toEqual([]);
  expect(db.query).not.toHaveBeenCalled();
});
