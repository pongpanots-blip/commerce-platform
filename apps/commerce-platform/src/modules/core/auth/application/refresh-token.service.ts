import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { User } from '../../user/infrastructure/user.entity';
import { normalizeStaffRole, STAFF_ROLES } from '../../../../shared-kernel/presentation/auth.decorators';
import { AuthRefreshToken, RefreshAudience } from '../infrastructure/auth-refresh-token.entity';

export type { RefreshAudience } from '../infrastructure/auth-refresh-token.entity';

/** What login and refresh hand back: the original login fields plus the refresh pair. */
export interface AuthSession {
  accessToken: string;
  role: string;
  mustChangePassword: boolean;
  refreshToken: string;
  /** Seconds until accessToken expires. */
  expiresIn: number;
  /** Seconds until refreshToken expires. */
  refreshExpiresIn: number;
}

export interface ClientMeta { userAgent?: string | null; ip?: string | null }

const positiveInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const DAY_MS = 24 * 60 * 60 * 1000;
/** AUTH_ACCESS_TOKEN_TTL_SECONDS (default 900 = 15 min). The JwtModule default (12 h) is left for other signers. */
export const accessTokenTtlSeconds = () => positiveInt(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 15 * 60);
/** AUTH_REFRESH_TOKEN_TTL_DAYS (default 30). Sliding: each rotated token gets the full TTL again, up to the family cap. */
export const refreshTokenTtlDays = () => positiveInt(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS, 30);
/** AUTH_REFRESH_TOKEN_FAMILY_MAX_DAYS (default 90): no sign-in outlives this, however often it is refreshed. */
export const refreshFamilyMaxDays = () => positiveInt(process.env.AUTH_REFRESH_TOKEN_FAMILY_MAX_DAYS, 90);

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Same message for every failure — the caller learns nothing about why. */
const invalid = () => new UnauthorizedException('invalid refresh token');

/**
 * Transaction-scoped advisory lock on one account's refresh tokens. issueSession (login), refresh, logout and
 * revokeAllForUser all take exactly this one lock (never two), so they serialize per account and cannot
 * deadlock each other.
 */
const lockAccount = (m: EntityManager, userId: string) =>
  m.query(`SELECT pg_advisory_xact_lock(hashtext('auth_refresh_token'), hashtext($1))`, [userId]);

type RefreshOutcome = { session: AuthSession } | { fail: true };

/**
 * Short access JWTs + rotating, single-use refresh tokens for commerce-admin (audience 'staff') and the
 * developer portal ('portal'). Only the sha256 of a token is stored (like the MCP OAuth grants). A refresh
 * spends the token, inserts its successor and — on reuse — revokes the family in ONE transaction under the
 * account lock: a crash cannot burn a token without a successor, and of two concurrent refreshes with the same
 * token the second sees it spent and ends the sign-in (the winner's new token included).
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(AuthRefreshToken) private readonly tokens: Repository<AuthRefreshToken>,
    private readonly jwt: JwtService,
  ) {}

  /**
   * A new sign-in: a fresh family, inserted under the account lock. The caller checked the account (password,
   * status, role) before this point; it is re-read under the lock, so a disable / role change / password change
   * whose revokeAllForUser already ran cannot be followed by a family minted from the stale check.
   * Every writer saves the account first and revokes second, so the re-read always sees the change.
   */
  async issueSession(user: User, audience: RefreshAudience, meta: ClientMeta = {}): Promise<AuthSession> {
    return this.tokens.manager.transaction(async (m) => {
      await lockAccount(m, user.id);
      const current = await m.getRepository(User).findOne({ where: { id: user.id } });
      const role = current ? normalizeStaffRole(current.role) : '';
      if (!current || current.status !== 'active' || role !== normalizeStaffRole(user.role)
        || (current.passwordHash ?? null) !== (user.passwordHash ?? null)
        || (audience === 'staff' && !STAFF_ROLES.includes(role as never))) {
        throw new UnauthorizedException('invalid credentials');
      }
      const now = new Date();
      return (await this.session(m, current, audience, { familyId: randomUUID(), familyCreatedAt: now }, meta, now)).session;
    });
  }

  async refresh(token: string, audience: RefreshAudience, meta: ClientMeta = {}): Promise<AuthSession> {
    if (typeof token !== 'string' || !token) throw invalid();
    const hash = tokenHash(token);
    const peek = await this.tokens.findOneBy({ tokenHash: hash });
    if (!peek || peek.audience !== audience) throw invalid();

    // failures that revoke must commit before the 401, so they are returned, not thrown, from the transaction
    const outcome = await this.tokens.manager.transaction(async (m): Promise<RefreshOutcome> => {
      await lockAccount(m, peek.userId);
      const tokens = m.getRepository(AuthRefreshToken);
      const row = await tokens.findOneBy({ id: peek.id }); // re-read under the lock
      const now = new Date();
      if (!row || row.revokedAt) return { fail: true };
      if (row.usedAt) {
        // an already-rotated token came back: someone else holds a copy — end the whole sign-in
        await this.revokeFamily(m, row.familyId, 'reuse');
        return { fail: true };
      }
      if (row.expiresAt.getTime() <= now.getTime()) return { fail: true };
      if (row.familyCreatedAt.getTime() + refreshFamilyMaxDays() * DAY_MS <= now.getTime()) {
        await this.revokeFamily(m, row.familyId, 'family_expired');
        return { fail: true };
      }

      const user = await m.getRepository(User).findOne({ where: { id: row.userId } });
      // canonical roles on both sides: a stored sale_manager is the same sign-in as sales_manager
      const role = user ? normalizeStaffRole(user.role) : '';
      if (!user || user.status !== 'active' || role !== normalizeStaffRole(row.roleAtIssue)
        || (audience === 'staff' && !STAFF_ROLES.includes(role as never))) {
        await this.revokeFamily(m, row.familyId, 'account_changed');
        return { fail: true };
      }

      const spent = await tokens.update({ id: row.id, usedAt: IsNull(), revokedAt: IsNull() }, { usedAt: now });
      if (spent.affected !== 1) {
        // cannot happen under the lock; if it ever does, two refreshes used one token — that is reuse
        await this.revokeFamily(m, row.familyId, 'reuse');
        return { fail: true };
      }
      const { session, next } = await this.session(m, user, audience, row, meta, now);
      await tokens.update({ id: row.id }, { replacedById: next.id });
      return { session };
    });
    if ('fail' in outcome) throw invalid();
    return outcome.session;
  }

  /** Ends the sign-in the token belongs to. Unknown, foreign or already-revoked tokens are a silent no-op. */
  async logout(token: string, audience: RefreshAudience): Promise<{ ok: true }> {
    if (typeof token !== 'string' || !token) return { ok: true };
    const row = await this.tokens.findOneBy({ tokenHash: tokenHash(token) });
    if (row && row.audience === audience) {
      await this.tokens.manager.transaction(async (m) => {
        await lockAccount(m, row.userId);
        await this.revokeFamily(m, row.familyId, 'logout');
      });
    }
    return { ok: true };
  }

  /** Every live refresh token of the account (disabled, role changed, password reset …). */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.tokens.manager.transaction(async (m) => {
      await lockAccount(m, userId);
      await m.getRepository(AuthRefreshToken).update({ userId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: reason });
    });
  }

  private async revokeFamily(m: EntityManager, familyId: string, reason: string): Promise<void> {
    await m.getRepository(AuthRefreshToken).update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: reason });
  }

  private async session(
    m: EntityManager, user: User, audience: RefreshAudience,
    family: { familyId: string; familyCreatedAt: Date }, meta: ClientMeta, now: Date,
  ) {
    const role = normalizeStaffRole(user.role);
    const refreshToken = randomBytes(32).toString('base64url');
    // sliding TTL, never past the family cap
    const expiresAt = new Date(Math.min(
      now.getTime() + refreshTokenTtlDays() * DAY_MS,
      family.familyCreatedAt.getTime() + refreshFamilyMaxDays() * DAY_MS,
    ));
    const tokens = m.getRepository(AuthRefreshToken);
    const next = await tokens.save(tokens.create({
      userId: user.id, familyId: family.familyId, familyCreatedAt: family.familyCreatedAt,
      tokenHash: tokenHash(refreshToken), audience, roleAtIssue: role, expiresAt,
      usedAt: null, revokedAt: null, revokedReason: null, replacedById: null,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 255) : null,
      ip: meta.ip ? meta.ip.slice(0, 64) : null,
    }));
    const expiresIn = accessTokenTtlSeconds();
    const session: AuthSession = {
      accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email, role }, { expiresIn }),
      role,
      mustChangePassword: !!user.mustChangePassword,
      refreshToken,
      expiresIn,
      refreshExpiresIn: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    };
    return { session, next };
  }
}
