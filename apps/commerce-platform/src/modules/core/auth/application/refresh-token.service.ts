import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
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
/** AUTH_ACCESS_TOKEN_TTL_SECONDS (default 900 = 15 min). The JwtModule default (12 h) is left for other signers. */
export const accessTokenTtlSeconds = () => positiveInt(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 15 * 60);
/** AUTH_REFRESH_TOKEN_TTL_DAYS (default 30). Sliding: each rotated token gets the full TTL again. */
export const refreshTokenTtlDays = () => positiveInt(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS, 30);

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Same message for every failure — the caller learns nothing about why. */
const invalid = () => new UnauthorizedException('invalid refresh token');

/**
 * Short access JWTs + rotating, single-use refresh tokens for commerce-admin (audience 'staff') and the
 * developer portal ('portal'). Same pattern as the MCP OAuth refresh grant: only the sha256 is stored and
 * a token is spent by an atomic `used_at IS NULL` update, so of two concurrent refreshes only one wins.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(AuthRefreshToken) private readonly tokens: Repository<AuthRefreshToken>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  /** A new sign-in: a fresh family. */
  issueSession(user: User, audience: RefreshAudience, meta: ClientMeta = {}): Promise<AuthSession> {
    return this.session(user, audience, randomUUID(), meta).then(({ session }) => session);
  }

  async refresh(token: string, audience: RefreshAudience, meta: ClientMeta = {}): Promise<AuthSession> {
    if (typeof token !== 'string' || !token) throw invalid();
    const row = await this.tokens.findOneBy({ tokenHash: tokenHash(token) });
    if (!row || row.audience !== audience || row.revokedAt) throw invalid();
    if (row.usedAt) {
      // an already-rotated token came back: someone else holds a copy — end the whole sign-in
      await this.revokeFamily(row.familyId, 'reuse');
      throw invalid();
    }
    if (row.expiresAt.getTime() <= Date.now()) throw invalid();

    const user = await this.users.findOne({ where: { id: row.userId } });
    // canonical roles on both sides: a stored sale_manager is the same sign-in as sales_manager
    const role = user ? normalizeStaffRole(user.role) : '';
    if (!user || user.status !== 'active' || role !== normalizeStaffRole(row.roleAtIssue)
      || (audience === 'staff' && !STAFF_ROLES.includes(role as never))) {
      await this.revokeFamily(row.familyId, 'account_changed');
      throw invalid();
    }

    const spent = await this.tokens.update({ id: row.id, usedAt: IsNull(), revokedAt: IsNull() }, { usedAt: new Date() });
    if (spent.affected !== 1) {
      // lost a race with another refresh of the same token — that is reuse too
      await this.revokeFamily(row.familyId, 'reuse');
      throw invalid();
    }
    const { session, next } = await this.session(user, audience, row.familyId, meta);
    await this.tokens.update({ id: row.id }, { replacedById: next.id });
    return session;
  }

  /** Ends the sign-in the token belongs to. Unknown, foreign or already-revoked tokens are a silent no-op. */
  async logout(token: string, audience: RefreshAudience): Promise<{ ok: true }> {
    if (typeof token === 'string' && token) {
      const row = await this.tokens.findOneBy({ tokenHash: tokenHash(token) });
      if (row && row.audience === audience) await this.revokeFamily(row.familyId, 'logout');
    }
    return { ok: true };
  }

  /** Every live refresh token of the account (disabled, role changed, password reset …). */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.tokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: reason });
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.tokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date(), revokedReason: reason });
  }

  private async session(user: User, audience: RefreshAudience, familyId: string, meta: ClientMeta) {
    const role = normalizeStaffRole(user.role);
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresIn = refreshTokenTtlDays() * 24 * 60 * 60;
    const next = await this.tokens.save(this.tokens.create({
      userId: user.id, familyId, tokenHash: tokenHash(refreshToken), audience, roleAtIssue: role,
      expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
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
      refreshExpiresIn,
    };
    return { session, next };
  }
}
