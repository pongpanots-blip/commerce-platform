import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffAuthGuard } from '../../core/auth/presentation/staff-auth.guard';
import { previewGoal, goalPreviewUrl, goalScenarioSchema } from './financial-goals';
import { fixtureGoalInputs, fixtureGoalScenario } from './goal-fixtures';
import { GoalPlanningController } from './goal-planning.controller';
import { GoalInputsService } from './goal-inputs.service';
import { GoalDraftsService } from './goal-drafts.service';

describe('financial goal HTTP roles and draft contracts (synthetic localhost)', () => {
  let app: INestApplication, base: string, jwt: JwtService;
  const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];
  const tokens = new Map<string, string>(), query = jest.fn(async () => []), transaction = jest.fn(async () => { throw Error('Fixture storage unavailable'); });
  const inputs = { inputs: jest.fn(), preview: jest.fn() };
  beforeAll(async () => {
    jwt = new JwtService({ secret: 'financial-goal-local-http-fixture-only' });
    const users = { findOne: async ({ where }: { where: { id: string } }) => ['disabled', 'pending-password'].includes(where.id) ? { id: where.id, email: 'blocked@example.invalid', role: 'admin', status: where.id === 'disabled' ? 'disabled' : 'active', mustChangePassword: where.id === 'pending-password' } : roles.includes(where.id) ? { id: where.id, email: `${where.id}@example.invalid`, role: where.id, status: 'active' } : null };
    const module = await Test.createTestingModule({ controllers: [GoalPlanningController], providers: [
      { provide: GoalInputsService, useValue: inputs }, { provide: GoalDraftsService, useValue: new GoalDraftsService({ query, transaction } as never, inputs as never) },
    ] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalGuards(new StaffAuthGuard(jwt, new Reflector(), users as never));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    for (const role of roles) tokens.set(role, await jwt.signAsync({ sub: role, role }));
  });
  afterAll(async () => app?.close());
  beforeEach(() => { jest.clearAllMocks(); inputs.inputs.mockResolvedValue(fixtureGoalInputs()); inputs.preview.mockImplementation(async raw => { const scenario = goalScenarioSchema.parse(raw), value = fixtureGoalInputs(); return previewGoal(scenario, value); }); });
  const headers = (role: string) => ({ authorization: `Bearer ${tokens.get(role)}`, 'content-type': 'application/json' });
  it('requires an active authenticated account before reading source or private draft data', async () => { expect((await fetch(`${base}/api/reports/financial-goals/inputs/2026-10`)).status).toBe(401); expect(inputs.inputs).not.toHaveBeenCalled(); });
  it.each([['disabled', 401], ['pending-password', 403]] as const)('%s is blocked before reading or saving even with an admin JWT', async (sub, status) => { const token = await jwt.signAsync({ sub, role: 'admin' }), auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }; expect((await fetch(`${base}/api/reports/financial-goals/drafts`, { headers: auth })).status).toBe(status); expect((await fetch(`${base}/api/reports/financial-goals/drafts`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(status); expect(query).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled(); });
  it.each(roles.filter(r => !['admin', 'sales_manager', 'business_analyst'].includes(r)))('%s cannot read financial context data or write planning drafts', async role => {
    for (const path of ['inputs/2026-10', 'drafts', 'preview?scenario=e30']) expect((await fetch(`${base}/api/reports/financial-goals/${path}`, { headers: headers(role) })).status).toBe(403);
    expect((await fetch(`${base}/api/reports/financial-goals/drafts`, { method: 'POST', headers: headers(role), body: '{}' })).status).toBe(403);
    expect(inputs.inputs).not.toHaveBeenCalled(); expect(inputs.preview).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['admin', 'sales_manager', 'business_analyst'])('%s can read/preview through existing team financial-report scope without operational writes', async role => {
    const input = await fetch(`${base}/api/reports/financial-goals/inputs/2026-10`, { headers: headers(role) }); expect(input.status).toBe(200); expect(input.headers.get('cache-control')).toBe('private, no-store');
    const response = await fetch(base + '/api' + goalPreviewUrl(fixtureGoalScenario()), { headers: headers(role) }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ inputs: { actuals: { internalCostExVat: null } }, preview: { persisted: false, operationalWrites: false, activationAllowed: false } }); expect(transaction).not.toHaveBeenCalled();
  });
  it('keeps BA GET-only and does not add a read-only-write exception', async () => {
    for (const role of ['business_analyst', 'sales_manager']) for (const [method, path] of [['POST', 'drafts'], ['PATCH', 'drafts/00000000-0000-4000-8000-000000000001']]) expect((await fetch(`${base}/api/reports/financial-goals/${path}`, { method, headers: headers(role), body: '{}' })).status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('uses the database account role rather than a caller-controlled admin claim', async () => {
    const token = await jwt.signAsync({ sub: 'merchandising', role: 'admin' }); expect((await fetch(`${base}/api/reports/financial-goals/drafts`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403); expect(query).not.toHaveBeenCalled();
  });
  it('rejects actor/actual-cost injection, malformed identities and oversized preview queries before data access', async () => {
    for (const body of [{}, { actorId: 'other' }, { requestId: 'not-a-uuid', scenario: fixtureGoalScenario() }, { requestId: '00000000-0000-4000-8000-000000000099', scenario: { ...fixtureGoalScenario(), actuals: { internalCostExVat: '1.00' } } }]) expect((await fetch(`${base}/api/reports/financial-goals/drafts`, { method: 'POST', headers: headers('admin'), body: JSON.stringify(body) })).status).toBe(400);
    for (const path of ['drafts?actorId=other', 'drafts/not-a-uuid', 'preview?scenario=bad!', 'preview?scenario=e30&role=admin', `preview?scenario=${'a'.repeat(7001)}`]) expect((await fetch(`${base}/api/reports/financial-goals/${path}`, { headers: headers('admin') })).status).toBe(400);
    expect(transaction).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(inputs.preview).not.toHaveBeenCalled();
  });
  it('makes authenticated ownership authoritative, returns useful empty lists and excludes operational endpoints', async () => {
    for (const role of ['admin', 'sales_manager', 'business_analyst']) { const response = await fetch(`${base}/api/reports/financial-goals/drafts`, { headers: headers(role) }); expect(await response.json()).toEqual({ items: [], next: null }); expect(query).toHaveBeenLastCalledWith(expect.stringContaining("scenario->>'kind'='financial_goal'"), [role, null]); }
    for (const path of ['execute', 'activate', 'apply-price', 'stock', 'reverse']) expect((await fetch(`${base}/api/reports/financial-goals/${path}`, { method: 'POST', headers: headers('admin'), body: '{}' })).status).toBe(404);
  });
  it('storage failure never produces persisted success', async () => {
    const response = await fetch(`${base}/api/reports/financial-goals/drafts`, { method: 'POST', headers: headers('admin'), body: JSON.stringify({ requestId: '00000000-0000-4000-8000-000000000099', scenario: fixtureGoalScenario() }) }); expect(response.status).toBe(503); expect(await response.json()).not.toMatchObject({ persisted: true });
  });
});
