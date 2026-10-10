import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffAuthGuard } from '../../core/auth/presentation/staff-auth.guard';
import { PromotionPlanningController } from './promotion-planning.controller';
import { PromotionDraftsService } from './promotion-drafts.service';
import { PromotionInputsService } from './promotion-inputs.service';
describe('promotion planning HTTP boundary (synthetic localhost)', () => {
  let app: INestApplication, base: string;
  const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];
  const tokens = new Map<string, string>();
  const query = jest.fn(async () => []), transaction = jest.fn(async () => { throw new Error('Unexpected persistence'); });
  const inputs = { inputs: jest.fn(), preview: jest.fn() };
  beforeAll(async () => {
    const jwt = new JwtService({ secret: 'local-promotion-planning-test-only' });
    const users = { findOne: async ({ where }: { where: { id: string } }) => roles.includes(where.id) ? { id: where.id, email: `${where.id}@example.invalid`, role: where.id, status: 'active' } : null };
    const module = await Test.createTestingModule({ controllers: [PromotionPlanningController], providers: [
      { provide: PromotionInputsService, useValue: inputs }, { provide: PromotionDraftsService, useValue: new PromotionDraftsService({ query, transaction } as never, inputs as never) },
    ] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalGuards(new StaffAuthGuard(jwt, new Reflector(), users as never));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/reports/promotion-planning`;
    for (const role of roles) tokens.set(role, await jwt.signAsync({ sub: role, role }));
  });
  afterAll(async () => app?.close());
  beforeEach(() => { jest.clearAllMocks(); inputs.inputs.mockResolvedValue({ sku: 'SKU', cost: null, stock: null, activationAllowed: false }); inputs.preview.mockResolvedValue({ preview: { persisted: false, activationAllowed: false, status: 'incomplete' } }); });
  const headers = (role: string) => ({ authorization: `Bearer ${tokens.get(role)}`, 'content-type': 'application/json' });
  it('requires authentication', async () => { expect((await fetch(`${base}/inputs/SKU`)).status).toBe(401); expect(inputs.inputs).not.toHaveBeenCalled(); });
  it.each(roles.filter(r => r !== 'admin'))('%s remains denied before source reads or proposal writes', async role => {
    expect((await fetch(`${base}/inputs/SKU`, { headers: headers(role) })).status).toBe(403);
    expect((await fetch(`${base}/drafts`, { method: 'POST', headers: headers(role), body: '{}' })).status).toBe(403);
    expect(inputs.inputs).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
  });
  it('allows admin observation and side-effect-free preview without a persisted-success claim', async () => {
    expect((await fetch(`${base}/inputs/SKU`, { headers: headers('admin') })).status).toBe(200);
    const response = await fetch(`${base}/preview`, { method: 'POST', headers: headers('admin'), body: '{}' });
    expect(await response.json()).toMatchObject({ preview: { persisted: false, activationAllowed: false } }); expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects actor injection, invalid cursors/IDs and malformed drafts before persistence', async () => {
    for (const body of [{}, { actorId: 'other' }, { requestId: 'invalid', scenario: {} }]) expect((await fetch(`${base}/drafts`, { method: 'POST', headers: headers('admin'), body: JSON.stringify(body) })).status).toBe(400);
    expect((await fetch(`${base}/drafts?actorId=other`, { headers: headers('admin') })).status).toBe(400);
    expect((await fetch(`${base}/drafts/not-a-uuid`, { headers: headers('admin') })).status).toBe(400); expect(transaction).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
  it('derives the draft owner from the authenticated row, returns empty lists and has no activation routes', async () => {
    const response = await fetch(`${base}/drafts`, { headers: headers('admin') }); expect(await response.json()).toEqual({ items: [], next: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('actor_id=$1'), ['admin', null]);
    for (const path of ['activate', 'apply-price', 'execute', 'stock']) expect((await fetch(`${base}/${path}`, { method: 'POST', headers: headers('admin'), body: '{}' })).status).toBe(404);
  });
});
