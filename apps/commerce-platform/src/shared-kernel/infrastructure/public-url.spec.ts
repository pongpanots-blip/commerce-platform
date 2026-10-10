import { assertPublicHttpUrl, isBlockedAddress } from './public-url';

const resolveTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

describe('isBlockedAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip'])(
    'blocks %s', (a) => expect(isBlockedAddress(a)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])('allows %s', (a) => expect(isBlockedAddress(a)).toBe(false));
});

describe('assertPublicHttpUrl', () => {
  it('rejects other schemes', () => expect(assertPublicHttpUrl('file:///etc/passwd', resolveTo('8.8.8.8'))).rejects.toThrow('scheme_not_allowed'));
  it('rejects junk', () => expect(assertPublicHttpUrl('http//x', resolveTo('8.8.8.8'))).rejects.toThrow('invalid_url'));
  it('rejects a literal private IP', () => expect(assertPublicHttpUrl('http://127.0.0.1:8080/x', resolveTo())).rejects.toThrow('blocked_url'));
  it('rejects decimal loopback', () => expect(assertPublicHttpUrl('http://2130706433/', resolveTo())).rejects.toThrow('blocked_url'));
  it('rejects bracketed IPv4-mapped IPv6', () => expect(assertPublicHttpUrl('http://[::ffff:127.0.0.1]/', resolveTo())).rejects.toThrow('blocked_url'));
  it('rejects a name with any private address', () =>
    expect(assertPublicHttpUrl('https://evil.example/h', resolveTo('8.8.8.8', '10.0.0.5'))).rejects.toThrow('blocked_url'));
  it('reports DNS failure', () =>
    expect(assertPublicHttpUrl('https://nope.example', async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow('dns_failed'));
  it('accepts a public name', async () =>
    expect((await assertPublicHttpUrl('https://hooks.example/a?b=1', resolveTo('93.184.216.34'))).host).toBe('hooks.example'));
});
