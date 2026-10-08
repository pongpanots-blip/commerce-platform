import { session } from '../lib/api';

/** Mirrors the staff guard: admin may write, a read-only role may not, everyone else only where the route already lists them. */
export function roleCanWrite(roles: readonly string[] = []) {
  const role = session.claims()?.role;
  if (!role || role === 'business_analyst') return false;
  if (role === 'admin') return true;
  return roles.includes(role);
}
