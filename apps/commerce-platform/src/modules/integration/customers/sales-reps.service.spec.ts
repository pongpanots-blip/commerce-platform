import { ConflictException, NotFoundException } from '@nestjs/common';
import { SalesRepsService } from './sales-reps.service';

const CO = '11111111-1111-4111-8111-111111111111', REP = '22222222-2222-4222-8222-222222222222';
function setup({ company = true, rep = true } = {}) {
  const published: Array<{ type: string; payload: unknown; metadata: unknown }> = [];
  const m = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('company_id')) return company ? [{}] : [];
      if (sql.includes('FROM josh_users')) return rep ? [{}] : [];
      return [];
    }),
  };
  const db = { transaction: jest.fn(async (fn: (x: unknown) => unknown) => fn(m)) };
  const events = { publish: jest.fn(async (e: { type: string; payload: unknown; metadata: unknown }) => { published.push(e); }) };
  return { svc: new SalesRepsService(db as never, events as never), m, published };
}

describe('SalesRepsService (stage 2b)', () => {
  beforeEach(() => { process.env.COMMERCE_OWNS_SALES_REPS = 'true'; });
  afterEach(() => { delete process.env.COMMERCE_OWNS_SALES_REPS; });

  it('refuses until commerce owns the assignment', async () => {
    process.env.COMMERCE_OWNS_SALES_REPS = 'false';
    await expect(setup().svc.assign(CO, REP)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s an unknown company or a rep who is not josh staff, like josh', async () => {
    await expect(setup({ company: false }).svc.assign(CO, REP)).rejects.toThrow('ไม่พบบริษัท');
    await expect(setup({ rep: false }).svc.assign(CO, REP)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upserts the assignment and publishes company.sales_rep as a snapshot', async () => {
    const { svc, m, published } = setup();
    const answer = await svc.assign(CO, REP);
    expect(answer).toEqual({ status: true, statusCode: 200, message: 'กำหนดพนักงานขายสำเร็จ', data: { id: CO, assigned_sales_user_id: REP } });
    expect(m.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO company_sales_reps'))).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: 'company.sales_rep', payload: { companyId: CO, salesUserId: REP }, metadata: { snapshot: true } });
  });

  it('null clears the rep without a rep check', async () => {
    const { svc, published } = setup({ rep: false });
    await svc.assign(CO, null);
    expect(published[0]).toMatchObject({ payload: { salesUserId: null } });
  });
});
