import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Raised with a code as the message: invalid_url | scheme_not_allowed | dns_failed | blocked_url. */
export class BlockedUrlError extends Error {}
export type Resolver = (host: string) => Promise<{ address: string }[]>;

const blocked = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fe80::', 10], ['fc00::', 7]] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** Loopback / private / link-local / CGNAT / multicast / IPv4-mapped — anything that is not a plain public address. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return address.toLowerCase().startsWith('::ffff:') || blocked.check(address, 'ipv6');
  return true;
}

const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/**
 * SSRF guard for outbound marketing webhooks: http(s) only, and every address the host resolves to must be public.
 * ponytail: fetch resolves the name again after this check (rebinding window of milliseconds); pin the checked
 * address with an undici dispatcher if that window ever matters.
 */
export async function assertPublicHttpUrl(raw: string, resolve: Resolver = systemResolver): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BlockedUrlError('invalid_url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('scheme_not_allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try { addresses = (await resolve(host)).map((a) => a.address); } catch { throw new BlockedUrlError('dns_failed'); }
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new BlockedUrlError('blocked_url');
  return url;
}
