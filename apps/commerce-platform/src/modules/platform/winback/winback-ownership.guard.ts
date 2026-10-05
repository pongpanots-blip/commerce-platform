import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { winbackOwnedByCommerce } from './shared/winback.config';

/**
 * Only one side writes winback. Until WINBACK_OWNER=commerce, josh runs it: commerce mirrors josh's
 * tables (read-only answers here are josh's data, minutes old) and refuses every write, so nothing
 * can be written on both sides.
 */
@Injectable()
export class WinbackOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const method = context.switchToHttp().getRequest<{ method: string }>().method;
    if (method === 'GET' || method === 'HEAD' || winbackOwnedByCommerce()) return true;
    throw new ConflictException('winback is still run by josh on this server (WINBACK_OWNER is not commerce) — write there');
  }
}
