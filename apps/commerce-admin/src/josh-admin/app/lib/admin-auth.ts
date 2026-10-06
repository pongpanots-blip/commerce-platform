/**
 * commerce-admin replacement for josh web-admin's admin-auth: the signed-in person is commerce's staff
 * session (josh acts as its commerce-platform account and records this email). Roles map admin → admin,
 * marketing → marketing, which is what josh's own pages check.
 */
import { session } from '../../../lib/api';

function payload(): Record<string, unknown> | null {
  const token = session.get();
  if (!token) return null;
  try { return JSON.parse(window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

export function getAdminToken(): string | null { return session.get(); }
export function isAdminTokenValid(): boolean { const exp = payload()?.exp; return !!session.get() && (typeof exp !== 'number' || exp * 1000 > Date.now()); }
export function getAdminRole(): string | null { const r = payload()?.role; return typeof r === 'string' ? r : null; }
export function getAdminUserId(): string | null { const s = payload()?.sub; return typeof s === 'string' ? s : null; }
export function clearAdminAuth(): void { session.clear(); }
export function forceAdminLogout(): void { session.clear(); window.location.href = '/'; }
export function installAdminUnauthorizedHandler(): void { /* commerce's own client handles 401 */ }
