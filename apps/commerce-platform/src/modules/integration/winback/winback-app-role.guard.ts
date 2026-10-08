import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { WINBACK_NAMED_ROLES } from './winback-roles';

const APP_ROLES = new Set<string>(WINBACK_NAMED_ROLES);

/** Sales app routes use Josh role codes, verified by AdminWriteGuard before this guard runs. */
@Injectable()
export class WinbackAppRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Commerce's AdminWriteGuard is always strict and sets req.user. Never use claimsFromBearer's
    // unverified dev fallback or isSecurityStrictMode here: this role gate applies in every environment.
    const req = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (!req.user?.role || !APP_ROLES.has(req.user.role)) {
      throw new ForbiddenException('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้');
    }
    return true;
  }
}
