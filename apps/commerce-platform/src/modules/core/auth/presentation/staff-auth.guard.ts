import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ALLOW_PENDING_PASSWORD_KEY, IS_PUBLIC_KEY, STAFF_ROLES, STAFF_ROLES_KEY, StaffRole } from '../../../../shared-kernel/presentation/auth.decorators';
import { User } from '../../user/infrastructure/user.entity';

export interface StaffPrincipal {
  userId: string;
  email: string;
  role: StaffRole;
  mustChangePassword?: boolean;
}

/**
 * Global default-deny guard (registered as APP_GUARD): every route needs a
 * staff bearer token unless marked @Public(). A new controller that forgets
 * auth is therefore closed, not open. Portal developer tokens share the JWT
 * secret but carry role 'developer', so they never pass here.
 *
 * The token only says who; the account row decides the rest on every request — a disabled
 * account or a changed role takes effect at once, not when the 12 h token runs out.
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

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

    if (!payload.role || !STAFF_ROLES.includes(payload.role as StaffRole)) {
      throw new ForbiddenException('this account cannot use this part of commerce-admin');
    }
    const account = payload.sub ? await this.users.findOne({ where: { id: payload.sub }, select: { id: true, email: true, role: true, status: true, mustChangePassword: true } }) : null;
    if (!account || account.status !== 'active') throw new UnauthorizedException('account disabled or removed');

    // a password someone else set (new account, reset): nothing but "who am I" and "change it" until changed
    if (account.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, targets)) {
      throw new ForbiddenException({ message: 'change your password first', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    const allowed = new Set<string>(['admin', ...(this.reflector.getAllAndOverride<StaffRole[]>(STAFF_ROLES_KEY, targets) ?? [])]);
    if (!allowed.has(account.role)) {
      throw new ForbiddenException('this account cannot use this part of commerce-admin');
    }
    request.staff = { userId: account.id, email: account.email, role: account.role, mustChangePassword: account.mustChangePassword } as StaffPrincipal;
    return true;
  }
}
