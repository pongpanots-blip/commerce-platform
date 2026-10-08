import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { NotificationService } from './shared/notification.service';
import { WinbackOwnershipGuard } from './winback-ownership.guard';
import { WinbackMirror, WinbackRowChanged } from './winback-mirror';

const SECRET = 'josh-jwt-test-secret';
const ctx = (req: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;

describe('winback in commerce', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  describe('AdminWriteGuard (josh access token, checked on the replica)', () => {
    const token = (claims: Record<string, unknown>, secret = SECRET) => new JwtService({ secret }).sign(claims);
    const replica = (row: unknown) => ({ configured: true, query: jest.fn().mockResolvedValue(row ? [row] : []) });

    beforeEach(() => { process.env.JOSH_JWT_SECRET = SECRET; });

    it('lets an internal, active, current-session josh user in and sets req.user', async () => {
      const r = replica({ token_version: 2, is_active: true, internal: true });
      const req = { headers: { authorization: `Bearer ${token({ sub: 'u1', email: 'rep@jagota.test', role: 'sales', tokenVersion: 2 })}` } } as Record<string, unknown>;
      await expect(new AdminWriteGuard(r as never).canActivate(ctx(req))).resolves.toBe(true);
      expect(req.user).toMatchObject({ sub: 'u1', role: 'sales' });
      expect(r.query.mock.calls[0][1]).toEqual(['u1', 'sales']);
    });

    it('refuses: no token, wrong secret, purpose token, logged-out session, suspended, customer role', async () => {
      const ok = { token_version: 0, is_active: true, internal: true };
      const run = (t: string | null, row: unknown = ok) => new AdminWriteGuard(replica(row) as never).canActivate(ctx({ headers: t ? { authorization: `Bearer ${t}` } : {} }));
      await expect(run(null)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(run(token({ sub: 'u1', role: 'sales' }, 'other-secret'))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(run(token({ sub: 'u1', role: 'sales', purpose: 'reset' }))).rejects.toThrow('ไม่ใช่ accessToken');
      await expect(run(token({ sub: 'u1', role: 'sales', tokenVersion: 1 }))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(run(token({ sub: 'u1', role: 'sales' }), { ...ok, is_active: false })).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(run(token({ sub: 'u1', role: 'customer' }), { ...ok, internal: false })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is closed (503) when this server cannot check josh tokens', async () => {
      delete process.env.JOSH_JWT_SECRET;
      await expect(new AdminWriteGuard(replica(null) as never).canActivate(ctx({ headers: { authorization: `Bearer ${token({ sub: 'u1', role: 'sales' })}` } }))).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  it('only one side writes: until WINBACK_OWNER=commerce every write here is refused, reads pass', () => {
    const guard = new WinbackOwnershipGuard();
    delete process.env.WINBACK_OWNER;
    expect(guard.canActivate(ctx({ method: 'GET' }))).toBe(true);
    expect(() => guard.canActivate(ctx({ method: 'POST' }))).toThrow(ConflictException);
    process.env.WINBACK_OWNER = 'commerce';
    expect(guard.canActivate(ctx({ method: 'PATCH' }))).toBe(true);
  });

  it('notifications go to josh through the outbox, winback ones only', async () => {
    const bus = { publish: jest.fn() };
    const n = new NotificationService(bus as never);
    await n.dispatch({ userId: '11111111-1111-4111-8111-111111111111', type: 'winback_lead_assigned', category: 'winback', data: { account_id: 'a1' }, dedupeKey: 'k1' });
    expect(bus.publish.mock.calls[0][0]).toMatchObject({ type: 'winback.notify', payload: { type: 'winback_lead_assigned', dedupeKey: 'k1', data: { account_id: 'a1' } } });
    await expect(n.dispatch({ userId: 'u', type: 'order_shipped', category: 'order_update' })).rejects.toThrow('winback notifications only');
  });

  describe('WinbackMirror', () => {
    /** A fake side: one table's rows as { id → hash }, answering the mirror's queries. */
    function side(hashes: Record<string, string>) {
      const queries: { sql: string; params?: unknown[] }[] = [];
      const m = {
        query: jest.fn(async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params });
          if (sql.startsWith('SELECT column_name')) return params?.[0] === 'winback_account' ? [{ column_name: 'id' }, { column_name: 'stage' }] : [{ column_name: 'id' }];
          if (sql.includes('md5(')) return sql.includes('FROM winback_account') ? Object.entries(hashes).map(([id, h]) => ({ id, h })) : [];
          if (sql.includes('row_to_json')) return (params![0] as string[]).map((id) => ({ r: { id, stage: 'lead' } }));
          return [];
        }),
      };
      const ds = { query: m.query, transaction: (fn: (x: typeof m) => unknown) => fn(m) };
      return { ds, m, queries };
    }

    it('josh owns: copies changed rows from the replica into commerce, deletes what josh no longer has', async () => {
      delete process.env.WINBACK_OWNER;
      const commerce = side({ a: 'h1', b: 'old', gone: 'x' });
      const josh = side({ a: 'h1', b: 'new', c: 'h3' });
      const replica = { configured: true, run: (fn: (ds: unknown) => unknown) => fn(josh.ds), query: josh.m.query };
      const result = await new WinbackMirror(commerce.ds as never, replica as never, { publish: jest.fn() } as never).run();
      expect(result[0]).toEqual({ table: 'winback_account', changed: 2, deleted: 1 });
      const insert = commerce.queries.find((q) => q.sql.startsWith('INSERT INTO winback_account'))!;
      expect(JSON.parse(insert.params![0] as string).map((r: { id: string }) => r.id).sort()).toEqual(['b', 'c']);
      expect(commerce.queries.find((q) => q.sql.startsWith('DELETE FROM winback_account'))!.params).toEqual([['gone']]);
      expect(commerce.queries.some((q) => q.sql === `SET LOCAL TimeZone = 'UTC'`)).toBe(true);
    });

    it('commerce owns: publishes latest-wins winback.row events to josh, once per content', async () => {
      process.env.WINBACK_OWNER = 'commerce';
      const commerce = side({ a: 'h1', b: 'new' });
      const josh = side({ a: 'h1', b: 'old', gone: 'x' });
      const replica = { configured: true, run: (fn: (ds: unknown) => unknown) => fn(josh.ds), query: josh.m.query };
      const bus = { publish: jest.fn() };
      const mirror = new WinbackMirror(commerce.ds as never, replica as never, bus as never);
      await mirror.run();
      const events = bus.publish.mock.calls.map((c) => c[0] as WinbackRowChanged);
      expect(events.map((e) => [e.payload.id, e.payload.row ? 'upsert' : 'delete'])).toEqual([['b', 'upsert'], ['gone', 'delete']]);
      expect(events[0].metadata).toEqual({ snapshot: true });
      bus.publish.mockClear();
      await mirror.run(); // josh has not caught up yet: nothing is published twice
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it('copies winback_app_record too, and skips it (no error) while one side has not migrated it', async () => {
      delete process.env.WINBACK_OWNER;
      const commerce = side({ a: 'h1' });
      const josh = side({ a: 'h1' });
      const result = await new WinbackMirror(commerce.ds as never, { configured: true, run: (fn: (ds: unknown) => unknown) => fn(josh.ds), query: josh.m.query } as never, { publish: jest.fn() } as never).run();
      expect(result.map((r) => r.table)).toContain('winback_app_record');

      const notMigrated = side({ a: 'h1' });
      const plain = notMigrated.m.query.getMockImplementation()!;
      notMigrated.m.query.mockImplementation(async (sql: string, params?: unknown[]) =>
        sql.startsWith('SELECT column_name') && params?.[0] === 'winback_app_record' ? [] : plain(sql, params));
      const replica = { configured: true, run: (fn: (ds: unknown) => unknown) => fn(notMigrated.ds), query: notMigrated.m.query };
      const skipped = await new WinbackMirror(side({ a: 'h1' }).ds as never, replica as never, { publish: jest.fn() } as never).run();
      expect(skipped.map((r) => r.table)).not.toContain('winback_app_record');
      expect(skipped).toHaveLength(6);
    });
  });
});
