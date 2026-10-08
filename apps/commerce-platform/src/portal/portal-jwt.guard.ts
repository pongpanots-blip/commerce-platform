import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../modules/core/user/infrastructure/user.entity';

/**
 * Developer-portal bearer JWT. The token only says who; the account row decides on every request (one
 * primary-key lookup, like StaffAuthGuard), so a disabled or removed account is shut out at once rather
 * than when its access token expires.
 */
@Injectable()
export class PortalJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Fail closed BEFORE verification: without a real secret in production the
    // JwtService would fall back to the public 'dev-portal-secret' and accept
    // forged tokens. Same semantics as PortalAuthService.assertSecret().
    if (process.env.NODE_ENV === 'production' && !process.env.PORTAL_JWT_SECRET) {
      throw new UnauthorizedException('portal auth unavailable');
    }
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('missing bearer token');
    let payload: { sub?: string; email?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
    const account = payload.sub
      ? await this.users.findOne({ where: { id: payload.sub }, select: { id: true, status: true } })
      : null;
    if (!account || account.status !== 'active') throw new UnauthorizedException('account disabled or removed');
    request.portalAccount = { accountId: payload.sub, email: payload.email };
    return true;
  }
}
