import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readBearerToken } from './bearer-token.util';
import { normalizeStaffRole } from '../../../../shared-kernel/presentation/auth.decorators';
import { acceptsJoshJwt } from './winback.config';
import { WinbackStaffIdentityService } from './winback-staff-identity.service';
import { WinbackPrincipal, WinbackRequest } from './winback-actor';
import { isWinbackManager } from '../winback-roles';
import { ownsStaff } from '../../customers/josh-staff-access.service';
import { COMMERCE_JWT_ISSUER } from '../../../../shared-kernel/presentation/jwt-issuer';

export type WinbackTokenKind = 'commerce' | 'commerce-legacy' | 'josh';

/**
 * Which issuer a bearer claims to be, read from the UNVERIFIED header + payload. The caller then verifies with that
 * issuer's secret only, so equal secrets (or a leaked one) can never make a token pass as the other kind.
 * - header `alg` must be HS256 (both sides sign HS256), else 401; a `purpose` claim (reset / OTP token) is 401;
 * - `iss` = COMMERCE_JWT_ISSUER → 'commerce' (verified with the commerce secret + issuer check);
 * - any other `iss` → 401 (unknown issuer);
 * - no `iss` and josh-shaped (`tokenVersion` or `companyId` claim — josh signs both on every access token) → 'josh';
 * - no `iss` and not josh-shaped → 'commerce-legacy': a commerce token signed before `iss` was added. It still has
 *   to verify with the commerce secret; these stop existing once the pre-deploy tokens expire (≤ 12 h).
 */
export function winbackTokenKind(token: string): WinbackTokenKind {
  const part = (i: number): Record<string, unknown> => {
    try {
      const value = JSON.parse(Buffer.from(token.split('.')[i] ?? '', 'base64url').toString('utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* fall through */ }
    throw new UnauthorizedException('Token อ่านไม่ได้ — malformed token');
  };
  const header = part(0), payload = part(1);
  if (header.alg !== 'HS256') throw new UnauthorizedException('unsupported token algorithm');
  // josh's email-OTP / password-reset tokens ({ sub: email, purpose }) and any other purpose token are not sessions.
  if ('purpose' in payload) throw new UnauthorizedException('Token นี้ไม่ใช่ accessToken — ใช้ค่าจาก POST /api/auth/login');
  if ('iss' in payload) {
    if (payload.iss === COMMERCE_JWT_ISSUER) return 'commerce';
    throw new UnauthorizedException('unknown token issuer');
  }
  return 'tokenVersion' in payload || 'companyId' in payload ? 'josh' : 'commerce-legacy';
}

/** The roles josh's AdminWriteGuard lets through for marketing-only routes (kept for imports that reference it). */
export const MARKETING_EDITOR_ROLES = new Set(['marketing', 'platform_admin', 'dev']);
const CACHE_MS = 60_000;

/** Commerce account checks run on every request; legacy Josh session checks retain their 60s cache. */
@Injectable()
export class AdminWriteGuard implements CanActivate {
  private readonly cache = new Map<string, { at: number; ok: true } | { at: number; error: Error }>();
  private jwt: JwtService | null = null;

  constructor(@InjectDataSource() private readonly db: DataSource,
    private readonly identities: WinbackStaffIdentityService = new WinbackStaffIdentityService(db)) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'production' && !process.env.PORTAL_JWT_SECRET) {
      throw new UnauthorizedException('staff auth unavailable');
    }
    const req = context.switchToHttp().getRequest<WinbackRequest & { headers: Record<string, string | undefined> }>();
    const token = readBearerToken(req.headers.authorization);
    if (!token) throw new UnauthorizedException('ไม่มีสิทธิ์เข้าถึง: กรุณาส่ง Token มายืนยัน');
    if (token.split('.').length !== 3) throw new UnauthorizedException('Token ไม่ครบ — JWT ต้องมีสามท่อน (header.payload.signature)');
    const kind = winbackTokenKind(token);
    if (kind === 'josh') {
      if (!acceptsJoshJwt()) throw new UnauthorizedException('กรุณาเข้าสู่ระบบด้วยบัญชี commerce — sign in with your commerce staff account');
      return this.josh(req, token);
    }
    // Commerce: ONLY the commerce secret, HS256, and the commerce issuer when the token names one. Any failure
    // (expired, bad signature, wrong issuer) is final — a token is never re-tried as josh's.
    let commerce: { sub?: string; role?: string; purpose?: unknown; typ?: unknown };
    try {
      commerce = await new JwtService({ secret: process.env.PORTAL_JWT_SECRET || 'dev-portal-secret' }).verifyAsync(token, {
        algorithms: ['HS256'], ...(kind === 'commerce' ? { issuer: COMMERCE_JWT_ISSUER } : {}),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      throw new UnauthorizedException(name === 'TokenExpiredError' ? 'commerce token expired — sign in again' : 'invalid commerce token');
    }
    if (!commerce || typeof commerce !== 'object' || 'purpose' in commerce || 'typ' in commerce || typeof commerce.sub !== 'string' || !commerce.sub) {
      throw new UnauthorizedException('Token นี้ไม่ใช่ accessToken');
    }
    // Developer tokens share the portal secret and must never authenticate staff, even after a row role change.
    if (normalizeStaffRole(commerce.role ?? '') === 'developer') throw new ForbiddenException('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้');
    const [row]: { id: string; email: string; role: string; status: string; must_change_password: boolean }[] = await this.db.query(
      'SELECT id, email, role, status, must_change_password FROM users WHERE id = $1', [commerce.sub]);
    if (!row || row.status !== 'active') throw new UnauthorizedException('account disabled or removed');
    if (row.must_change_password) throw new ForbiddenException({ message: 'change your password first', code: 'PASSWORD_CHANGE_REQUIRED' });
    const role = normalizeStaffRole(row.role);
    if (!['sale', 'sales_manager', 'admin'].includes(role)) throw new ForbiddenException('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้');
    await this.setActor(req, row.id, role, row.email, 'commerce');
    return true;
  }

  private async setActor(req: WinbackRequest, sub: string, role: string, email: string | undefined, source: 'commerce' | 'josh') {
    const identity = await this.identities.resolve(source, sub);
    const actor: WinbackPrincipal = { ...identity, role: normalizeStaffRole(role), email, source, isManager: isWinbackManager(role) };
    req.winbackActor = actor;
    req.user = { sub: actor.id, email, role: actor.role, source };
  }

  private async josh(req: WinbackRequest, token: string): Promise<boolean> {
    const secret = process.env.JOSH_JWT_SECRET?.trim();
    if (!secret) throw new ServiceUnavailableException('winback sign-in is not configured on this server (JOSH_JWT_SECRET).');
    this.jwt ??= new JwtService({ secret });
    let payload: { sub?: string; email?: string; role?: string; tokenVersion?: number; purpose?: unknown; typ?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token, { secret, algorithms: ['HS256'] });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      throw new UnauthorizedException(name === 'TokenExpiredError' ? 'Token หมดอายุ — login ใหม่ที่ POST /api/auth/login' : 'Token หมดอายุหรือไม่ถูกต้อง');
    }
    if (payload && typeof payload === 'object' && ('purpose' in payload || 'typ' in payload)) throw new UnauthorizedException('Token นี้ไม่ใช่ accessToken — ใช้ค่าจาก POST /api/auth/login');
    if (typeof payload?.sub !== 'string' || !payload.sub || typeof payload.role !== 'string' || !payload.role.trim()) throw new UnauthorizedException('ไม่มีสิทธิ์เข้าถึง: กรุณาส่ง Token มายืนยัน');

    const key = `${payload.sub}:${payload.tokenVersion ?? 0}:${payload.role}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      if ('error' in hit) throw hit.error;
    } else {
      try {
        await this.check(payload.sub, Number(payload.tokenVersion ?? 0), payload.role.trim());
        this.cache.set(key, { at: Date.now(), ok: true });
      } catch (error) {
        if (error instanceof UnauthorizedException || error instanceof ForbiddenException) this.cache.set(key, { at: Date.now(), error });
        throw error;
      }
    }
    await this.setActor(req, payload.sub, payload.role.trim(), payload.email, 'josh');
    return true;
  }

  private async check(userId: string, tokenVersion: number, role: string) {
    // josh checks the token's role against app_roles; the copy has the user's current role type — a token
    // whose role is no longer the user's is refused (re-login), which is stricter, never looser.
    // Stage 6 (COMMERCE_OWNS_STAFF): commerce's own decision (josh_staff_access) counts at once, before josh echoes it
    // back — a disable / sign-out / role change made in commerce-admin only ever makes this stricter.
    const owned = ownsStaff();
    const [row]: Array<{ token_version: number; is_active: boolean; internal: boolean }> = await this.db.query(
      owned
        ? `SELECT CASE WHEN s.token_version < COALESCE(a.min_token_version, 0) THEN -1 ELSE s.token_version END AS token_version,
             s.is_active AND COALESCE(a.is_active, true) AS is_active,
             (s.user_type = 'internal' AND s.role = $2 AND COALESCE(a.role, $2) = $2) AS internal
           FROM josh_staff s LEFT JOIN josh_staff_access a ON a.id = s.id WHERE s.id = $1`
        : `SELECT token_version, is_active, (user_type = 'internal' AND role = $2) AS internal FROM josh_staff WHERE id = $1`, [userId, role]);
    // A customer (no staff row) is refused as josh refuses it: 403, not a stale-session 401.
    if (!row && (await this.db.query(`SELECT 1 FROM josh_users WHERE id = $1`, [userId])).length) throw new ForbiddenException('เฉพาะผู้ใช้งาน internal เท่านั้น');
    if (!row || Number(row.token_version ?? 0) !== tokenVersion) throw new UnauthorizedException('Token หมดอายุ — login ใหม่ที่ POST /api/auth/login');
    if (row.is_active === false) throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', message: 'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', code: 'ACCOUNT_SUSPENDED' });
    if (!row.internal) throw new ForbiddenException('เฉพาะผู้ใช้งาน internal เท่านั้น');
  }
}
