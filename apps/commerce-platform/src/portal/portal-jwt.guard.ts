import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class PortalJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

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
    try {
      const payload = await this.jwt.verifyAsync(token);
      request.portalAccount = { accountId: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }
}
