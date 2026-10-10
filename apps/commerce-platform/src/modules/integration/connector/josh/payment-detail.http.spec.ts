import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffAuthGuard } from '../../../core/auth/presentation/staff-auth.guard';
import { JoshBackofficeController } from './josh-backoffice.controller';
import { JoshBackoffice } from './josh-backoffice';
import { JoshApiLogs } from './josh-api-logs';

/** Isolated localhost app: synthetic staff/replica rows, no production module or DB connection. */
describe('payment detail HTTP boundary', () => {
  let app: INestApplication, base: string;
  const roles = ['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic'];
  const tokens = new Map<string, string>();
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (!sql.startsWith('SELECT ') || !sql.includes('WHERE t.id::text = $1 LIMIT 1') || params.length !== 1) throw new Error('Unexpected query');
    return params[0] === 'payment-1' ? [{ id: 'payment-1', order_id: 'order-1', status: 'success', amount: 100, currency: 'THB', company_name: 'Synthetic company' }] : [];
  });
  beforeAll(async () => {
    const jwt = new JwtService({ secret: 'local-payment-detail-test-only' });
    const users = { findOne: async ({ where }: { where: { id: string } }) => roles.includes(where.id) ? { id: where.id, email: `${where.id}@example.invalid`, role: where.id, status: 'active' } : null };
    const module = await Test.createTestingModule({ controllers: [JoshBackofficeController], providers: [
      { provide: JoshBackoffice, useValue: new JoshBackoffice({ configured: true, query } as never) },
      { provide: JoshApiLogs, useValue: { available: false } },
    ] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api');
    app.useGlobalGuards(new StaffAuthGuard(jwt, new Reflector(), users as never));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/reports/payment-transactions`;
    for (const role of roles) tokens.set(role, await jwt.signAsync({ sub: role, role }));
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => query.mockClear());
  const headers = (role: string) => ({ authorization: `Bearer ${tokens.get(role)}` });
  it('requires authentication', async () => { expect((await fetch(`${base}/payment-1`)).status).toBe(401); expect(query).not.toHaveBeenCalled(); });
  it.each(roles.filter(role => role !== 'admin'))('%s remains denied before a source read', async role => { expect((await fetch(`${base}/payment-1`, { headers: headers(role) })).status).toBe(403); expect(query).not.toHaveBeenCalled(); });
  it('allows one admin SELECT while making no settlement claim', async () => { const response = await fetch(`${base}/payment-1`, { headers: headers('admin') }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ source: 'josh_replica', freshness: 'unavailable', record: { id: 'payment-1', status: 'success' } }); expect(query).toHaveBeenCalledTimes(1); });
  it('returns not found for missing records and rejects malformed identity before reads', async () => { expect((await fetch(`${base}/absent`, { headers: headers('admin') })).status).toBe(404); query.mockClear(); expect((await fetch(`${base}/${'a'.repeat(101)}`, { headers: headers('admin') })).status).toBe(400); expect(query).not.toHaveBeenCalled(); });
  it('exposes no payment mutation method', async () => { for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) expect((await fetch(`${base}/payment-1`, { method, headers: headers('admin') })).status).toBe(404); expect(query).not.toHaveBeenCalled(); });
});
