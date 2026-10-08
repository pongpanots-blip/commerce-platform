import { normalizeStaffRole } from '../../../../shared-kernel/presentation/auth.decorators';
import { isWinbackManager } from '../winback-roles';

export interface WinbackPrincipal {
  id: string;
  role: string;
  isManager: boolean;
  email?: string;
  source: 'commerce' | 'josh';
  joshId?: string;
}

export interface WinbackRequest {
  winbackActor?: WinbackPrincipal;
  user?: { sub?: string; role?: string; email?: string; source?: 'commerce' | 'josh' };
}

/** Reads only guard-verified identity; bearer decoding remains the controller's dev-only fallback. */
export function winbackActorOf(req: WinbackRequest): WinbackPrincipal | undefined {
  if (req?.winbackActor) return req.winbackActor;
  if (!req?.user?.sub) return undefined;
  const role = normalizeStaffRole(req.user.role ?? '');
  return { id: req.user.sub, role, email: req.user.email, source: req.user.source ?? 'josh', isManager: isWinbackManager(role) };
}
