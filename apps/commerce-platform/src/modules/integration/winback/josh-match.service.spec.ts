import { JoshMatchService } from './josh-match.service';
import { JoshMatchHit } from './matching.service';

const account = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  customer_code: `TMP-${id}`,
  display_name: `shop ${id}`,
  restaurant_name: null,
  company_name: null,
  company_registration_num: null,
  register_number: null,
  id_card_number: null,
  email: null,
  josh_user_id: null,
  josh_company_id: null,
  restaurant_place_id: `place-${id}`,
  lifecycle: 'tmp',
  assigned_sales_user_id: null,
  create_date: new Date(),
  ...extra,
});

function setup(rows: ReturnType<typeof account>[], hits: JoshMatchHit[], contacts: { account_id: string; email: string }[] = []) {
  const accounts = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
    find: jest.fn(async () => rows),
  };
  const contactRepo = { find: jest.fn(async () => contacts) };
  const lookup = {
    hits: jest.fn(async () => hits),
    companyNames: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `name of ${id}`]))),
  };
  return new JoshMatchService(accounts as never, contactRepo as never, lookup as never);
}

describe('JoshMatchService', () => {
  it('checks one account, masks the PII it tried and names the companies', async () => {
    const service = setup(
      [account('a', { company_registration_num: '0105512345678' })],
      [{ account_id: 'a', key: 'register_number', user_id: 'u1', company_id: 'c1' }],
      [{ account_id: 'a', email: 'owner@somtum.co.th' }],
    );
    const report = await service.checkAccount('a');
    expect(report.status).toBe('found_not_linked');
    expect(report.candidate).toEqual({ josh_company_id: 'c1', josh_user_id: 'u1' });
    expect(report.company_names).toEqual({ c1: 'name of c1' });
    const values = Object.fromEntries(report.signals.map((s) => [s.key, s.value]));
    expect(values.register_number).toBe('010******5678');
    expect(values.email).toBe('ow***@somtum.co.th');
    expect(JSON.stringify(report)).not.toContain('0105512345678');
  });

  it('404s an unknown account', async () => {
    await expect(setup([], []).checkAccount('nope')).rejects.toThrow('winback account not found');
  });

  it('counts every status over all enriched leads, then filters and pages', async () => {
    const service = setup(
      [account('a'), account('b', { company_name: 'X' }), account('c')],
      [
        { account_id: 'a', key: 'email', user_id: 'u1', company_id: 'c1' },
        { account_id: 'b', key: 'company_name', user_id: null, company_id: 'c2' },
      ],
    );
    const out = await service.enrichReport({ status: 'no_match', limit: 10 });
    expect(out.meta.counts).toMatchObject({ found_not_linked: 1, name_only: 1, no_match: 1, matched: 0 });
    expect(out.meta).toMatchObject({ total: 1, checked: 3, truncated: false });
    expect(out.data.map((r) => r.account_id)).toEqual(['c']);
  });
});
