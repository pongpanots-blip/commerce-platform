import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthRefreshToken } from '../infrastructure/auth-refresh-token.entity';
import { User } from '../../user/infrastructure/user.entity';
import { AuthRefreshToken1795800000000 } from '../../../../migrations/1795800000000-AuthRefreshToken';
import { RefreshTokenService } from './refresh-token.service';

/*
 * Refresh rotation and login under real Postgres locking (pg_advisory_xact_lock + one transaction per call).
 * Opt-in, migrated scratch DB only (needs `users`; creates auth_refresh_token IF NOT EXISTS):
 *   AUTH_TEST_DATABASE_URL=postgres:///commerce_auth_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand refresh-token.service.db
 */
const url = process.env.AUTH_TEST_DATABASE_URL;
const USER = '00000000-0000-4000-8000-0000000a0701';

type Row = { id: string; family_id: string; used_at: Date | null; revoked_at: Date | null; revoked_reason: string | null; replaced_by_id: string | null };

(url ? describe : describe.skip)('RefreshTokenService against a database', () => {
  let db: DataSource;
  let svc: RefreshTokenService;
  let jwt: JwtService;
  const clean = async () => {
    await db.query(`DELETE FROM auth_refresh_token WHERE user_id = $1`, [USER]);
    await db.query(`DELETE FROM users WHERE id = $1`, [USER]);
  };
  const user = async () => (await db.getRepository(User).findOneByOrFail({ id: USER }));
  const family = async (): Promise<Row[]> => db.query(`SELECT id, family_id, used_at, revoked_at, revoked_reason, replaced_by_id FROM auth_refresh_token WHERE user_id = $1 ORDER BY created_at, id`, [USER]);
  const live = async () => (await family()).filter((r) => !r.revoked_at && !r.used_at);
  /**
   * Hold the first refresh inside its transaction — signing runs after the spend and the successor insert,
   * before COMMIT — and resolve `reached` once it is there, so the competing call really overlaps it.
   */
  const holdFirstRefresh = (ms = 300) => {
    const real = jwt.signAsync.bind(jwt);
    let first = true;
    let markReached!: () => void;
    const reached = new Promise<void>((r) => { markReached = r; });
    const spy = jest.spyOn(jwt, 'signAsync').mockImplementation((async (...args: Parameters<JwtService['signAsync']>) => {
      if (first) { first = false; markReached(); await new Promise((r) => setTimeout(r, ms)); }
      return real(...args);
    }) as never);
    return { reached, restore: () => spy.mockRestore() };
  };
  const reset = async () => {
    await clean();
    await db.query(`INSERT INTO users (id, email, role, status) VALUES ($1, 'refresh-db-spec@jagota.test', 'merchandising', 'active')`, [USER]);
  };

  beforeAll(async () => {
    jwt = new JwtService({ secret: 'db-spec-secret' });
    const mod = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url, entities: [AuthRefreshToken, User], synchronize: false, extra: { max: 10 } }),
        TypeOrmModule.forFeature([AuthRefreshToken]),
      ],
      providers: [RefreshTokenService, { provide: JwtService, useValue: jwt }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(RefreshTokenService);
    const runner = db.createQueryRunner();
    try { await new AuthRefreshToken1795800000000().up(runner); } finally { await runner.release(); }
    await clean();
  });
  beforeEach(reset);
  afterAll(async () => { if (db) { await clean(); await db.destroy(); } });

  it('the same token refreshed concurrently: exactly one new pair; the loser is reuse and revokes the winner\'s successor', async () => {
    const first = await svc.issueSession(await user(), 'staff');
    const hold = holdFirstRefresh();
    const winner = svc.refresh(first.refreshToken, 'staff');
    await hold.reached; // spent + successor inserted, not committed yet
    const results = await Promise.allSettled([winner, ...Array.from({ length: 4 }, () => svc.refresh(first.refreshToken, 'staff'))]);
    hold.restore();
    const won = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(won).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof UnauthorizedException)).toBe(true);
    const rows = await family();
    expect(rows).toHaveLength(2); // the presented token + exactly one successor
    expect(rows[0].replaced_by_id).toBe(rows[1].id);
    expect(rows.every((r) => r.revoked_reason === 'reuse')).toBe(true);
    await expect(svc.refresh(won[0].refreshToken, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout racing a refresh of the same token never leaves a live token behind', async () => {
    // logout arriving while the refresh is mid-transaction (the dangerous order)…
    let s = await svc.issueSession(await user(), 'staff');
    const hold = holdFirstRefresh();
    const refreshing = svc.refresh(s.refreshToken, 'staff');
    await hold.reached;
    await svc.logout(s.refreshToken, 'staff');
    const refreshed = await refreshing;
    hold.restore();
    expect(await live()).toEqual([]);
    await expect(svc.refresh(refreshed.refreshToken, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);
    // …and both started together, a few times
    for (let i = 0; i < 3; i++) {
      await reset();
      s = await svc.issueSession(await user(), 'staff');
      await Promise.allSettled([svc.refresh(s.refreshToken, 'staff'), svc.logout(s.refreshToken, 'staff')]);
      expect(await live()).toEqual([]);
    }
  });

  it('revokeAllForUser arriving mid-refresh never leaves a live token behind', async () => {
    const a = await svc.issueSession(await user(), 'staff');
    await svc.issueSession(await user(), 'portal');
    const hold = holdFirstRefresh();
    const refreshing = svc.refresh(a.refreshToken, 'staff');
    await hold.reached;
    await svc.revokeAllForUser(USER, 'disabled');
    const refreshed = await refreshing;
    hold.restore();
    expect(await live()).toEqual([]);
    await expect(svc.refresh(refreshed.refreshToken, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a login racing revokeAllForUser leaves no surviving active token issued before the revoke', async () => {
    // revoke arriving while the login is mid-transaction (family row inserted, not committed): it waits for the
    // account lock, then revokes the login's row
    const hold = holdFirstRefresh(); // holds the first signAsync, which issueSession also runs after its insert
    const signingIn = svc.issueSession(await user(), 'staff');
    await hold.reached;
    await db.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [USER]);
    await svc.revokeAllForUser(USER, 'disabled');
    const session = await signingIn;
    hold.restore();
    expect(await live()).toEqual([]);
    await expect(svc.refresh(session.refreshToken, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);

    // the other order: the login checked the account, then disable + revoke committed, then the login inserts —
    // it re-reads the account under the lock and refuses instead of minting a family from the stale check
    await reset();
    const checked = await user();
    await db.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [USER]);
    await svc.revokeAllForUser(USER, 'disabled');
    await expect(svc.issueSession(checked, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await family()).toEqual([]);

    // same for a password change (the login verified the old hash)
    await reset();
    const beforeChange = await user();
    await db.query(`UPDATE users SET password_hash = 'changed' WHERE id = $1`, [USER]);
    await svc.revokeAllForUser(USER, 'password_changed');
    await expect(svc.issueSession(beforeChange, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await family()).toEqual([]);

    // and both started together, a few times
    for (let i = 0; i < 3; i++) {
      await reset();
      const stale = await user();
      await Promise.allSettled([
        svc.issueSession(stale, 'staff'),
        (async () => {
          await db.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [USER]);
          await svc.revokeAllForUser(USER, 'disabled');
        })(),
      ]);
      expect(await live()).toEqual([]);
    }
  });

  it('a failure after the spend (here: signing) rolls back — the token is not burnt', async () => {
    const s = await svc.issueSession(await user(), 'staff');
    const sign = jest.spyOn(jwt, 'signAsync').mockRejectedValueOnce(new Error('boom'));
    await expect(svc.refresh(s.refreshToken, 'staff')).rejects.toThrow('boom');
    sign.mockRestore();
    const rows = await family();
    expect(rows).toHaveLength(1);
    expect(rows[0].used_at).toBeNull();
    await expect(svc.refresh(s.refreshToken, 'staff')).resolves.toMatchObject({ role: 'merchandising' });
  });

  it('reuse detection commits the family revoke even though the call 401s', async () => {
    const a = await svc.issueSession(await user(), 'staff');
    const b = await svc.refresh(a.refreshToken, 'staff');
    await expect(svc.refresh(a.refreshToken, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);
    expect((await family()).every((r) => r.revoked_reason === 'reuse')).toBe(true);
    await expect(svc.refresh(b.refreshToken, 'staff')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
