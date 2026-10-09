import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { CommercePreviewsController } from './commerce-previews.controller';
import { CommercePreviewsService } from './commerce-previews.service';
import { StaffAuthGuard } from '../../core/auth/presentation/staff-auth.guard';

const id = '11111111-1111-4111-8111-111111111111';
/** Local Nest route/guard integration only. No production modules, workers, DB connections or credentials are loaded. */
describe('commerce preview HTTP boundary', () => {
  let app: INestApplication;
  let base: string;
  let adminToken: string;
  let merToken: string;
  const rows = new Map([
    ['admin-test', { id: 'admin-test', email: 'admin@example.invalid', role: 'admin', status: 'active' }],
    ['mer-test', { id: 'mer-test', email: 'mer@example.invalid', role: 'merchandising', status: 'active' }],
  ]);
  const writes = jest.fn(() => { throw new Error('Unexpected mutation'); });
  const db = { query: jest.fn(async (sql: string, params: unknown[]) => {
    if (!/^\s*SELECT\b/.test(sql) || params[0] !== id) throw new Error('Unexpected database operation');
    if (sql.includes('FROM josh_orders WHERE') || sql.includes('FROM jagota_order_sync_history WHERE') || sql.includes('FROM josh_order_lines l')) return [];
    throw new Error('Unexpected internal endpoint');
  }), transaction: writes, getRepository: writes };
  const replica = { configured: false, query: jest.fn(() => { throw new Error('Unexpected replica access'); }) };
  beforeAll(async () => {
    const jwt = new JwtService({ secret: 'local-preview-http-test-only' });
    const users = { findOne: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null };
    const mod = await Test.createTestingModule({ controllers: [CommercePreviewsController],
      providers: [{ provide: CommercePreviewsService, useValue: new CommercePreviewsService(db as never, replica as never) }] }).compile();
    app = mod.createNestApplication({ logger: false });
    app.setGlobalPrefix('api'); app.useGlobalGuards(new StaffAuthGuard(jwt, new Reflector(), users as never));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/reports/commerce-previews`;
    adminToken = await jwt.signAsync({ sub: 'admin-test', role: 'admin' });
    merToken = await jwt.signAsync({ sub: 'mer-test', role: 'merchandising' });
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { db.query.mockClear(); writes.mockClear(); replica.query.mockClear(); });
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

  it('requires staff authentication and keeps MER denied without source calls', async () => {
    expect((await fetch(`${base}/orders/${id}/review`)).status).toBe(401);
    expect((await fetch(`${base}/orders/${id}/review`, { headers: headers(merToken) })).status).toBe(403);
    expect((await fetch(`${base}/promotions/rehearsal`, { method: 'POST', headers: headers(merToken), body: '{}' })).status).toBe(403);
    expect(db.query).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });
  it('returns an honest incomplete read-only review for admin when source data is absent', async () => {
    const response = await fetch(`${base}/orders/${id}/review`, { headers: headers(adminToken) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'review', operationalWrites: false, reconciliation: 'incomplete', riskAssessment: 'incomplete' });
    expect(db.query).toHaveBeenCalledTimes(3); expect(writes).not.toHaveBeenCalled(); expect(replica.query).not.toHaveBeenCalled();
  });
  it('rejects invalid IDs, unknown URL parameters and malformed/blank thresholds before reads', async () => {
    for (const path of ['orders/not-a-uuid/review', `orders/${id}/review?url=http%3A%2F%2Flocalhost`,
      `orders/${id}/review?pendingSyncAfterMs=`, `orders/${id}/review?pendingSyncAfterMs=-1`]) {
      expect((await fetch(`${base}/${path}`, { headers: headers(adminToken) })).status).toBe(400);
    }
    expect(db.query).not.toHaveBeenCalled();
  });
  it('returns HTTP200 preview without implying a created/persisted campaign', async () => {
    const source = { id: 'fixture-price', version: '1', asOf: '2026-10-09T11:00:00Z', validUntil: '2026-10-09T13:00:00Z' };
    const body = { at: '2026-10-09T12:00:00Z', line: { sku: 'SKU-1', quantity: 1, unit: 'PC', quantityKind: 'count' },
      price: { kind: 'selling_price', sku: 'SKU-1', unit: 'PC', currency: 'THB', unitPrice: '100', source, pricingSource: 'base', pricingBasis: 'fixed_selling_unit', tax: { basis: 'inclusive', rateBasisPoints: 0 } },
      cost: null, stock: null, rules: [], stacking: 'none', minimumGrossMarginPercent: null };
    const response = await fetch(`${base}/promotions/rehearsal`, { method: 'POST', headers: headers(adminToken), body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'preview', status: 'incomplete', persisted: false, activationAllowed: false });
    expect(db.query).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });
  it('has no activation, retry or repair route and fails malformed rehearsal bodies', async () => {
    for (const path of ['promotions/activate', `orders/${id}/repair`, `orders/${id}/retry`]) {
      expect((await fetch(`${base}/${path}`, { method: 'POST', headers: headers(adminToken), body: '{}' })).status).toBe(404);
    }
    const invalid = await fetch(`${base}/promotions/rehearsal`, { method: 'POST', headers: headers(adminToken), body: JSON.stringify({ fetchUrl: 'http://169.254.169.254' }) });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ code: 'INVALID_REHEARSAL' });
    expect(db.query).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });
});
