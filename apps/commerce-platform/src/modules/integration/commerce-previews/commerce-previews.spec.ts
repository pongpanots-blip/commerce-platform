import 'reflect-metadata';
import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { CommercePreviewsController } from './commerce-previews.controller';
import { CommercePreviewsService } from './commerce-previews.service';
import { StaffAuthGuard } from '../../core/auth/presentation/staff-auth.guard';

const id = '11111111-1111-4111-8111-111111111111';
const at = '2026-10-09T12:00:00Z';
const created = '2026-10-09T10:00:00Z';
const policy = { consistencyGraceMs: 30_000, maxEvidenceAgeMs: 300_000, maxCaptureSkewMs: 30_000, pendingSyncAfterMs: 900_000 };
function readers() {
  const unexpected: string[] = [];
  const head = { id, order_number: 'ORDER-1', status: 'paid', total: '107.00', paid: true, create_date: created, version: '12', ignoredPrivateField: 'DO_NOT_RETURN' };
  const db = { query: jest.fn(async (sql: string, params: unknown[]) => {
    if (!/^\s*SELECT\b/.test(sql) || /\b(INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE)\b/i.test(sql) || params[0] !== id) {
      unexpected.push(sql); throw new Error('Unexpected database operation');
    }
    if (sql.includes('FROM josh_orders WHERE')) return [{ ...head }];
    if (sql.includes('FROM jagota_order_sync_history WHERE')) return [{ id: 'sync-1', order_id: id, shipment_id: null, version: '2', sync_status: 'sent', doc_no: 'DOC-1', created_at: created, imported_at: at }];
    if (sql.includes('FROM josh_order_lines l LEFT JOIN josh_order_stock_moves')) return [{ line_id: 'line-1', sku: 'SKU-1', ordered: 1, deducted: '1', state: 'deducted', updated_at: created }];
    unexpected.push(sql); throw new Error('Unexpected internal query');
  }), transaction: jest.fn(() => { throw new Error('No transactions/mutations'); }), getRepository: jest.fn(() => { throw new Error('No repository writes'); }) };
  const replica = { configured: true, query: jest.fn(async (sql: string, params: unknown[]) => {
    if (!/^\s*SELECT\b/.test(sql) || !sql.includes('FROM orders o WHERE o.orders_id = $1') || params[0] !== id) {
      unexpected.push(sql); throw new Error('Unexpected replica query');
    }
    return [{ ...head }];
  }) };
  return { db, replica, unexpected, service: new CommercePreviewsService(db as never, replica as never) };
}

describe('registered preview services and default staff access', () => {
  it('reads only fixed parameterized internal projections; does not retry, fetch or persist', async () => {
    const r = readers(); const network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected endpoint'));
    try {
      const result = await r.service.order(id, policy, () => new Date(at));
      expect(result).toMatchObject({ mode: 'review', reconciliation: 'consistent', operationalWrites: false });
      expect(r.db.query).toHaveBeenCalledTimes(3); expect(r.replica.query).toHaveBeenCalledTimes(1);
      expect(r.db.query.mock.calls.map(c => c[1])).toEqual([[id], [id, 101], [id, 101]]);
      expect(r.db.transaction).not.toHaveBeenCalled(); expect(r.db.getRepository).not.toHaveBeenCalled();
      expect(r.unexpected).toEqual([]); expect(network).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN');
    } finally { network.mockRestore(); }
  });
  it('keeps source failures unavailable with one attempt, without exposing error/SQL/credentials', async () => {
    const r = readers(); r.replica.query.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_FAILURE_DETAILS'));
    const result = await r.service.order(id, policy, () => new Date(at));
    expect(result.reconciliation).toBe('incomplete'); expect(result.findings.some(f => f.code === 'source_unavailable')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DATABASE_FAILURE_DETAILS'); expect(r.replica.query).toHaveBeenCalledTimes(1);
    expect(r.db.transaction).not.toHaveBeenCalled();
  });
  it('handles a disconnected replica without trying credentials or a fallback endpoint', async () => {
    const r = readers(); r.replica.configured = false;
    expect((await r.service.order(id, policy, () => new Date(at))).reconciliation).toBe('incomplete');
    expect(r.replica.query).not.toHaveBeenCalled();
  });
  it('marks legacy version zero and truncated scopes incomplete instead of losing evidence', async () => {
    const r = readers(); r.replica.query.mockResolvedValueOnce([{ id, order_number: 'ORDER-1', status: 'paid', total: '107.00', paid: true, create_date: created, version: '0', ignoredPrivateField: 'DO_NOT_RETURN' }]);
    expect((await r.service.order(id, policy, () => new Date(at))).reconciliation).toBe('incomplete');
    const q = readers(); const original = q.db.query.getMockImplementation()!;
    q.db.query.mockImplementation(async (sql, params) => sql.includes('FROM jagota_order_sync_history')
      ? Array.from({ length: 101 }, (_, i) => ({ id: `sync-${i}`, order_id: id, shipment_id: `shipment-${i}`, version: '1', sync_status: 'sent', doc_no: 'DOC', created_at: created, imported_at: at }))
      : original(sql, params));
    const result = await q.service.order(id, policy, () => new Date(at));
    expect(result.riskCoverage).toBe('partial'); expect(result.findings.some(f => f.code === 'source_scope_truncated')).toBe(true);
  });
  it('records real per-read capture times and detects slow/skewed comparison', async () => {
    const r = readers(); let calls = 0;
    const clock = () => new Date(Date.parse(at) + calls++ * 60_000);
    const result = await r.service.order(id, policy, clock);
    expect(result.findings.some(f => f.code === 'capture_time_skew')).toBe(true);
  });
  it('normalizes UUID casing before matching database record identities', async () => {
    const r = readers(); r.db.query.mockResolvedValue([]); r.replica.query.mockResolvedValue([]);
    const lower = 'aaaaaaaa-1111-4111-8111-111111111111';
    await r.service.order(lower.toUpperCase(), policy, () => new Date(at));
    expect(r.replica.query.mock.calls[0][1]).toEqual([lower]);
    expect(r.db.query.mock.calls.every(c => c[1][0] === lower)).toBe(true);
  });
  it('rejects URL/SQL identifiers and invalid policies before any source query', async () => {
    const r = readers();
    await expect(r.service.order('http://169.254.169.254/', policy)).rejects.toBeInstanceOf(BadRequestException);
    await expect(r.service.order(id, { ...policy, maxEvidenceAgeMs: -1 })).rejects.toThrow('invalid_review_policy');
    expect(r.db.query).not.toHaveBeenCalled(); expect(r.replica.query).not.toHaveBeenCalled();
    const controller = new CommercePreviewsController(r.service);
    expect(() => controller.order(id, { url: 'http://localhost/internal' })).toThrow(BadRequestException);
    expect(() => controller.promotion({ url: 'http://localhost/internal' })).toThrow(BadRequestException);
  });
  it('promotion rehearsal is an in-memory preview and never reads a supplied source URL', () => {
    const r = readers(); const stamp = { id: 'cost-evidence', version: '1', asOf: created, validUntil: '2026-10-09T13:00:00Z' };
    const result = r.service.promotion({ at, line: { sku: 'SKU-1', quantity: 1, unit: 'PC', quantityKind: 'count' },
      price: { kind: 'selling_price', sku: 'SKU-1', unit: 'PC', currency: 'THB', unitPrice: '100', source: stamp, pricingSource: 'base', pricingBasis: 'fixed_selling_unit', tax: { basis: 'inclusive', rateBasisPoints: 0 } },
      cost: null, stock: null, rules: [], stacking: 'none', minimumGrossMarginPercent: null });
    expect(result).toMatchObject({ mode: 'preview', persisted: false, activationAllowed: false, status: 'incomplete' });
    expect(r.db.query).not.toHaveBeenCalled(); expect(r.replica.query).not.toHaveBeenCalled();
  });
  const jwt = new JwtService({ secret: 'commerce-preview-synthetic-test-only' });
  const context = (token: string | null, method: 'promotion' | 'order') => ({
    getType: () => 'http', getHandler: () => CommercePreviewsController.prototype[method], getClass: () => CommercePreviewsController,
    switchToHttp: () => ({ getRequest: () => ({ method: method === 'promotion' ? 'POST' : 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} }) }),
  } as unknown as ExecutionContext);
  it.each(['merchandising', 'marketing', 'business_analyst', 'sale', 'sales_manager', 'cs', 'graphic'])('does not grant %s either new admin endpoint', async role => {
    const users = { findOne: jest.fn(async () => ({ id: 'test-user', email: 'test@example.invalid', role, status: 'active' })) };
    const guard = new StaffAuthGuard(jwt, new Reflector(), users as never);
    const token = await jwt.signAsync({ sub: 'test-user', role: 'admin' }); // Even a previous admin claim cannot widen the current row's role.
    await expect(guard.canActivate(context(token, 'promotion'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context(token, 'order'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows active admin under the existing default and rejects unauthenticated/disabled staff', async () => {
    const row = { id: 'test-user', email: 'test@example.invalid', role: 'admin', status: 'active' };
    const users = { findOne: jest.fn(async () => row) };
    const guard = new StaffAuthGuard(jwt, new Reflector(), users as never);
    const token = await jwt.signAsync({ sub: row.id, role: row.role });
    await expect(guard.canActivate(context(token, 'promotion'))).resolves.toBe(true);
    await expect(guard.canActivate(context(token, 'order'))).resolves.toBe(true);
    await expect(guard.canActivate(context(null, 'order'))).rejects.toBeInstanceOf(UnauthorizedException);
    row.status = 'disabled'; await expect(guard.canActivate(context(token, 'order'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
