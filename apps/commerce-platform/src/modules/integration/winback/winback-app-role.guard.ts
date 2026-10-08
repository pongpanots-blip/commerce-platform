import { winbackActorOf, WinbackRequest } from './shared/winback-actor';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { normalizeStaffRole } from '../../../shared-kernel/presentation/auth.decorators';
import { WINBACK_NAMED_ROLES } from './winback-roles';

const APP_ROLES = new Set<string>(WINBACK_NAMED_ROLES);

/** Sales app routes accept canonical sales roles from either token source after AdminWriteGuard. */
@Injectable()
export class WinbackAppRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Commerce's AdminWriteGuard is always strict and sets req.user. Never use claimsFromBearer's
    // unverified dev fallback or isSecurityStrictMode here: this role gate applies in every environment.
    const req = context.switchToHttp().getRequest<WinbackRequest>();
    const role = winbackActorOf(req)?.role;
    if (!role || !APP_ROLES.has(normalizeStaffRole(role))) {
      throw new ForbiddenException('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้');
    }
    return true;
  }
}
