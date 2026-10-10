/** Even split that sums to exactly 100 (the first branches take the remainder). */
export function evenPercents(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

const INTERNAL_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1$|\[::1\]$)/i;

/**
 * Early hint while typing a webhook URL (the server's SSRF guard is the real check). URLs with `{{…}}` are
 * only known at send time, so they get no hint.
 */
export function urlWarning(url: string): 'scheme' | 'internal' | null {
  if (!url || url.includes('{{')) return null;
  if (!/^https?:\/\//i.test(url)) return 'scheme';
  let host = '';
  try { host = new URL(url).hostname; } catch { return 'scheme'; }
  return INTERNAL_HOST.test(host) ? 'internal' : null;
}
