import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffAuthGuard } from '../../core/auth/presentation/staff-auth.guard';
import { comparePacks, packPreviewUrl, packScenarioSchema } from './pack-price';
import { fixtureInputs, fixtureScenario } from './pack-fixtures';
import { PackPlanningController } from './pack-planning.controller';
import { PackInputsService } from './pack-inputs.service';
import { PackDraftsService } from './pack-drafts.service';

describe('pack planning HTTP roles and draft contracts (synthetic localhost)', () => {
  let app: INestApplication, base: string, jwt: JwtService;
  const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];
  const tokens = new Map<string, string>(), query = jest.fn(async () => []), transaction = jest.fn(async () => { throw Error('Fixture storage unavailable'); });
  const inputs = { inputs: jest.fn(), preview: jest.fn() };
  beforeAll(async () => {
    jwt = new JwtService({ secret: 'pack-planning-local-http-fixture-only' });
    const users = { findOne: async ({ where }: { where: { id: string } }) => roles.includes(where.id) ? { id: where.id, email: `${where.id}@example.invalid`, role: where.id, status: 'active' } : null };
    const module = await Test.createTestingModule({ controllers: [PackPlanningController], providers: [
      { provide: PackInputsService, useValue: inputs }, { provide: PackDraftsService, useValue: new PackDraftsService({ query, transaction } as never, inputs as never) },
    ] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalGuards(new StaffAuthGuard(jwt, new Reflector(), users as never));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    for (const role of roles) tokens.set(role, await jwt.signAsync({ sub: role, role }));
  });
  afterAll(async () => app?.close());
  beforeEach(() => { jest.clearAllMocks(); inputs.inputs.mockResolvedValue(fixtureInputs()); inputs.preview.mockImplementation(async raw => { const scenario = packScenarioSchema.parse(raw), value = fixtureInputs(); return { scenario, inputs: value, preview: comparePacks(scenario, value) }; }); });
  const headers = (role: string) => ({ authorization: `Bearer ${tokens.get(role)}`, 'content-type': 'application/json' });
  it('requires an active authenticated account before reading source or private draft data', async () => { expect((await fetch(`${base}/api/reports/pack-price-planning/inputs/SYNTHETIC-SKU`)).status).toBe(401); expect(inputs.inputs).not.toHaveBeenCalled(); });
  it.each(roles.filter(r => !['admin', 'marketing', 'business_analyst'].includes(r)))('%s cannot read competitor/cost data or write planning drafts', async role => {
    for (const path of ['inputs/SYNTHETIC-SKU', 'drafts', 'preview?scenario=e30']) expect((await fetch(`${base}/api/reports/pack-price-planning/${path}`, { headers: headers(role) })).status).toBe(403);
    expect((await fetch(`${base}/api/reports/pack-price-planning/drafts`, { method: 'POST', headers: headers(role), body: '{}' })).status).toBe(403);
    expect(inputs.inputs).not.toHaveBeenCalled(); expect(inputs.preview).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['admin', 'marketing', 'business_analyst'])('%s can read/preview through existing competitor scope without operational writes', async role => {
    const input = await fetch(`${base}/api/reports/pack-price-planning/inputs/SYNTHETIC-SKU`, { headers: headers(role) }); expect(input.status).toBe(200); expect(input.headers.get('cache-control')).toBe('private, no-store');
    const response = await fetch(base + '/api' + packPreviewUrl(fixtureScenario()), { headers: headers(role) }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ inputs: { cost: null }, preview: { persisted: false, operationalWrites: false, activationAllowed: false } }); expect(transaction).not.toHaveBeenCalled();
  });
  it('keeps BA GET-only and does not add a read-only-write exception', async () => {
    for (const [method, path] of [['POST', 'drafts'], ['PATCH', 'drafts/00000000-0000-4000-8000-000000000001']]) expect((await fetch(`${base}/api/reports/pack-price-planning/${path}`, { method, headers: headers('business_analyst'), body: '{}' })).status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('uses the database account role rather than a caller-controlled admin claim', async () => {
    const token = await jwt.signAsync({ sub: 'merchandising', role: 'admin' }); expect((await fetch(`${base}/api/reports/pack-price-planning/drafts`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403); expect(query).not.toHaveBeenCalled();
  });
  it('rejects actor/source-cost injection, malformed identities and oversized preview queries before data access', async () => {
    for (const body of [{}, { actorId: 'other' }, { requestId: 'not-a-uuid', scenario: fixtureScenario() }, { requestId: '00000000-0000-4000-8000-000000000099', scenario: { ...fixtureScenario(), cost: '1.00' } }]) expect((await fetch(`${base}/api/reports/pack-price-planning/drafts`, { method: 'POST', headers: headers('marketing'), body: JSON.stringify(body) })).status).toBe(400);
    for (const path of ['drafts?actorId=other', 'drafts/not-a-uuid', 'preview?scenario=bad!', 'preview?scenario=e30&role=admin', `preview?scenario=${'a'.repeat(7001)}`]) expect((await fetch(`${base}/api/reports/pack-price-planning/${path}`, { headers: headers('marketing') })).status).toBe(400);
    expect(transaction).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled(); expect(inputs.preview).not.toHaveBeenCalled();
  });
  it('makes authenticated ownership authoritative, returns useful empty lists and excludes operational endpoints', async () => {
    for (const role of ['admin', 'marketing', 'business_analyst']) { const response = await fetch(`${base}/api/reports/pack-price-planning/drafts`, { headers: headers(role) }); expect(await response.json()).toEqual({ items: [], next: null }); expect(query).toHaveBeenLastCalledWith(expect.stringContaining("scenario->>'kind'='pack_price'"), [role, null]); }
    for (const path of ['execute', 'activate', 'apply-price', 'stock', 'reverse']) expect((await fetch(`${base}/api/reports/pack-price-planning/${path}`, { method: 'POST', headers: headers('admin'), body: '{}' })).status).toBe(404);
  });
  it('storage failure never produces persisted success', async () => {
    const response = await fetch(`${base}/api/reports/pack-price-planning/drafts`, { method: 'POST', headers: headers('marketing'), body: JSON.stringify({ requestId: '00000000-0000-4000-8000-000000000099', scenario: fixtureScenario() }) }); expect(response.status).toBe(503); expect(await response.json()).not.toMatchObject({ persisted: true });
  });
});
