import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StaffAuthGuard } from '../../core/auth/presentation/staff-auth.guard';
import { AllExceptionsFilter } from '../../../shared-kernel/presentation/all-exceptions.filter';
import { GuidedAnalysisModule } from './guided-analysis.module';
import { GuidedAnalysisService } from './guided-analysis.service';
import { normalizeGuidedQuery, verifyGuidedPreview } from './guided-analysis.contracts';

const roles = ['admin', 'business_analyst', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'graphic'];
describe('guided analysis: real active-account StaffAuthGuard and GET-only contracts', () => {
  let app: INestApplication, base: string, service: GuidedAnalysisService;
  const jwt = new JwtService({ secret: 'guided-analysis-owned-http-fixture-only' });
  const headers = (sub: string, role = sub) => ({ authorization: `Bearer ${jwt.sign({ sub, role })}` });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [GuidedAnalysisModule] }).compile();
    service = module.get(GuidedAnalysisService);
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalGuards(new StaffAuthGuard(jwt, new Reflector(), { findOne: async ({ where }: { where: { id: string } }) => roles.includes(where.id) ? { id: where.id, role: where.id, email: where.id + '@example.invalid', status: 'active', mustChangePassword: false } : where.id === 'disabled' ? { id: where.id, role: 'admin', status: 'disabled' } : where.id === 'pending' ? { id: where.id, role: 'business_analyst', status: 'active', mustChangePassword: true } : null } as never));
    await app.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/reports/guided-analysis`;
  });
  afterAll(async () => app.close());
  afterEach(() => jest.restoreAllMocks());
  it.each(roles)('%s can access exactly the authorized read-only template/preview scope', async role => {
    for (const path of ['templates', 'preview?template=repeat_buyers_inactive']) {
      const res = await fetch(base + '/' + path, { headers: headers(role) });
      expect(res.status).toBe(['admin', 'business_analyst'].includes(role) ? 200 : 403);
      if (res.status === 200) expect(res.headers.get('cache-control')).toBe('private, no-store');
      if (res.status === 200 && path.startsWith('preview')) expect(verifyGuidedPreview(await res.json(), normalizeGuidedQuery({ template: 'repeat_buyers_inactive' })).counts.matched).toBeNull();
    }
  });
  it('uses the current account role rather than a broader token role', async () => {
    expect((await fetch(base + '/templates', { headers: headers('marketing', 'admin') })).status).toBe(403);
    expect((await fetch(base + '/templates', { headers: headers('business_analyst', 'marketing') })).status).toBe(200);
  });
  it.each(['disabled', 'missing', 'pending'])('blocks %s accounts before source reads', async sub => {
    const spy = jest.spyOn(service, 'preview');
    expect((await fetch(base + '/preview?template=repeat_buyers_inactive', { headers: headers(sub, 'admin') })).status).toBe(sub === 'pending' ? 403 : 401);
    expect(spy).not.toHaveBeenCalled();
  });
  it('rejects anonymous reads and exposes no POST/PATCH/activation handler or BA exemption', async () => {
    expect((await fetch(base + '/templates')).status).toBe(401);
    for (const method of ['POST', 'PATCH', 'DELETE']) expect((await fetch(base + '/preview', { method, headers: headers('business_analyst') })).status).toBe(404);
    expect((await fetch(base + '/activate', { method: 'POST', headers: headers('admin') })).status).toBe(404);
  });
  it.each(['template=repeat_buyers_inactive&tenantId=other', 'template=repeat_buyers_inactive&branchIds=other', 'template=repeat_buyers_inactive&actor=other', 'template=repeat_buyers_inactive&evaluatedAt=2026-10-09', 'template=repeat_buyers_inactive&inactiveDays=7&inactiveDays=14', 'template=repeat_buyers_inactive&purchaseWindowDays=7&inactiveDays=14', 'template=approved_without_order&approvalAgeDays=6', 'template=unknown'])('rejects malformed/overriding GET input %s', async query => {
    expect((await fetch(base + '/preview?' + query, { headers: headers('business_analyst') })).status).toBe(400);
  });
  it('HEAD follows the original read-only guard without invoking operational writes', async () => {
    const res = await fetch(base + '/templates', { method: 'HEAD', headers: headers('business_analyst') });
    expect(res.status).toBe(200); expect(await res.text()).toBe('');
  });
});
