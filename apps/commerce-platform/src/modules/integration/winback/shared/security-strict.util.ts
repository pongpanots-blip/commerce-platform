declare const process:
  | { env?: Record<string, string | undefined> }
  | undefined;

const env =
  typeof process !== 'undefined'
    ? ((process.env || {}) as Record<string, string | undefined>)
    : {};

/** Production-style hardening (JWT on admin writes, lock seed). Dev defaults off. */
export function isSecurityStrictMode(
  source: Record<string, string | undefined> = env,
): boolean {
  const flag = source.SECURITY_STRICT_MODE?.trim().toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'on') {
    return true;
  }
  if (flag === 'false' || flag === '0' || flag === 'off') {
    return false;
  }
  return source.NODE_ENV === 'production';
}

export function isThrottlingEnabled(
  source: Record<string, string | undefined> = env,
): boolean {
  const flag = source.THROTTLE_ENABLED?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') {
    return false;
  }
  return true;
}

export function resolveThrottleLimit(
  source: Record<string, string | undefined> = env,
): number {
  const parsed = Number(source.THROTTLE_LIMIT ?? '100');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

export function resolveAuthThrottleLimit(
  source: Record<string, string | undefined> = env,
): number {
  const parsed = Number(source.THROTTLE_AUTH_LIMIT ?? '10');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export function resolveThrottleTtlMs(
  source: Record<string, string | undefined> = env,
): number {
  const parsed = Number(source.THROTTLE_TTL_MS ?? '60000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

/**
 * Compat window for `LegacyOwnerAuthGuard` — the 2026-08-14 security review
 * found `GET /orders/:id`, `GET /users/:id/dashboard` and
 * `GET /users/:id/private-prices` had no auth at all. Requiring a token
 * outright risks breaking a mobile build that has never sent one to these
 * three routes. While this is on (default), a *missing* token is let through
 * anonymously — logged loudly so `api_logs` shows whether anything still
 * calls these without one. An *invalid* token is never waved through; only
 * "no Authorization header at all" gets the grace path.
 *
 * Flip to 'false' once mobile confirms it sends Bearer here — no redeploy
 * needed, the routes then behave exactly like every other HybridAuthGuard
 * endpoint. Delete this flag and `LegacyOwnerAuthGuard` once nothing depends
 * on it anymore.
 */
export function isLegacyAuthGraceEnabled(
  source: Record<string, string | undefined> = env,
): boolean {
  const flag = source.LEGACY_AUTH_GRACE_PERIOD?.trim().toLowerCase();
  return flag !== 'false' && flag !== '0' && flag !== 'off';
}
