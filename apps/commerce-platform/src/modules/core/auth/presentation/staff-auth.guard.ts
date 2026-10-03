import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, STAFF_ROLES_KEY, StaffRole } from '../../../../shared-kernel/presentation/auth.decorators';

export interface StaffPrincipal {
  userId: string;
  email: string;
  role: StaffRole;
}

/**
 * Global default-deny guard (registered as APP_GUARD): every route needs a
 * staff bearer token unless marked @Public(). A new controller that forgets
 * auth is therefore closed, not open. Portal developer tokens share the JWT
 * secret but carry role 'developer', so they never pass here.
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    // Non-HTTP contexts (queue workers, schedulers) are not requests.
    if (context.getType() !== 'http') return true;

    if (process.env.NODE_ENV === 'production' && !process.env.PORTAL_JWT_SECRET) {
      // Without a real secret the JwtService falls back to a public dev secret.
      throw new UnauthorizedException('staff auth unavailable');
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('missing bearer token');

    let payload: { sub?: string; email?: string; role?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }

    const allowed = new Set<string>(['admin', ...(this.reflector.getAllAndOverride<StaffRole[]>(STAFF_ROLES_KEY, targets) ?? [])]);
    if (!payload.role || !allowed.has(payload.role)) {
      throw new ForbiddenException('this account cannot use this part of commerce-admin');
    }
    request.staff = { userId: payload.sub, email: payload.email, role: payload.role } as StaffPrincipal;
    return true;
  }
}
