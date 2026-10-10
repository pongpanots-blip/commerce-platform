/**
 * Behind nginx: count hops so rate limits (public POST /api/events, MCP) key on the real client IP, not the proxy.
 * Applied at boot for the whole app — not only when MCP is mounted.
 */
export function applyTrustProxy(http: { set: (key: string, value: unknown) => unknown }, env: Record<string, string | undefined>): void {
  const hops = Number(env.TRUST_PROXY_HOPS);
  if (hops > 0) http.set('trust proxy', hops);
}
