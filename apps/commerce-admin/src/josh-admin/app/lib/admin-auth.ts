/**
 * commerce-admin replacement for josh web-admin's admin-auth: the signed-in person is commerce's staff
 * session (josh acts as its commerce-platform account and records this email). Roles map admin → admin,
 * marketing → marketing, which is what josh's own pages check.
 */
import { logout, session } from '../../../lib/api';

function payload(): Record<string, unknown> | null {
  const token = session.get();
  if (!token) return null;
  try { return JSON.parse(window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

export function getAdminToken(): string | null { return session.get(); }
/** Signed in: a fresh access token, or a refresh token the next API call can trade for one (15-min tokens expire often). */
export function isAdminTokenValid(): boolean { return session.usable(); }
export function getAdminRole(): string | null { const r = payload()?.role; return typeof r === 'string' ? r : null; }
export function getAdminUserId(): string | null { const s = payload()?.sub; return typeof s === 'string' ? s : null; }
export function clearAdminAuth(): void { session.clear(); }
export function forceAdminLogout(): void { void logout().finally(() => { window.location.href = '/'; }); }
export function installAdminUnauthorizedHandler(): void { /* commerce's own client handles 401 */ }
