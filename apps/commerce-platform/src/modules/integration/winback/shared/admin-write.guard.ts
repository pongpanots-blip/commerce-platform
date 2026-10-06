import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JoshReplica } from '../../../integration/connector/josh/josh-replica';
import { readBearerToken } from './bearer-token.util';

/** The roles josh's AdminWriteGuard lets through for marketing-only routes (kept for imports that reference it). */
export const MARKETING_EDITOR_ROLES = new Set(['marketing', 'platform_admin', 'dev']);
const CACHE_MS = 60_000;

/**
 * josh's AdminWriteGuard for the saleactivity app, in commerce: the app keeps logging in at josh
 * (`POST /api/auth/login`) and sends josh's access token. Same checks josh runs — HybridAuthGuard
 * (signature with josh's JWT secret, not a purpose token, the session still valid: user active and
 * `tokenVersion` = users.token_version) then InternalAuthGuard (app_roles.user_type = 'internal') —
 * read from josh's replica, cached 60s like josh. Always strict here (josh skips it outside prod).
 */
@Injectable()
export class AdminWriteGuard implements CanActivate {
  private readonly cache = new Map<string, { at: number; ok: true } | { at: number; error: Error }>();
  private jwt: JwtService | null = null;

  constructor(private readonly replica: JoshReplica) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = process.env.JOSH_JWT_SECRET?.trim();
    if (!secret || !this.replica.configured) throw new ServiceUnavailableException('winback sign-in is not configured on this server (JOSH_JWT_SECRET / JOSH_DATABASE_URL).');
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const token = readBearerToken(req.headers.authorization);
    if (!token) throw new UnauthorizedException('ไม่มีสิทธิ์เข้าถึง: กรุณาส่ง Token มายืนยัน');
    if (token.split('.').length !== 3) throw new UnauthorizedException('Token ไม่ครบ — JWT ต้องมีสามท่อน (header.payload.signature) จาก POST /api/auth/login');

    this.jwt ??= new JwtService({ secret });
    let payload: { sub?: string; email?: string; role?: string; tokenVersion?: number; purpose?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token, { secret, algorithms: ['HS256'] });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      throw new UnauthorizedException(name === 'TokenExpiredError' ? 'Token หมดอายุ — login ใหม่ที่ POST /api/auth/login' : 'Token หมดอายุหรือไม่ถูกต้อง');
    }
    if (payload && typeof payload === 'object' && 'purpose' in payload) throw new UnauthorizedException('Token นี้ไม่ใช่ accessToken — ใช้ค่าจาก POST /api/auth/login');
    if (!payload?.sub || !payload.role?.trim()) throw new UnauthorizedException('ไม่มีสิทธิ์เข้าถึง: กรุณาส่ง Token มายืนยัน');

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
    req.user = payload;
    return true;
  }

  private async check(userId: string, tokenVersion: number, role: string) {
    const [row] = await this.replica.query<{ token_version: number; is_active: boolean; internal: boolean }>(
      `SELECT u.token_version, u.is_active, EXISTS (SELECT 1 FROM app_roles r WHERE r.code = $2 AND r.user_type = 'internal') AS internal
         FROM users u WHERE u.id = $1`, [userId, role]);
    if (!row || Number(row.token_version ?? 0) !== tokenVersion) throw new UnauthorizedException('Token หมดอายุ — login ใหม่ที่ POST /api/auth/login');
    if (row.is_active === false) throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', message: 'บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', code: 'ACCOUNT_SUSPENDED' });
    if (!row.internal) throw new ForbiddenException('เฉพาะผู้ใช้งาน internal เท่านั้น');
  }
}
