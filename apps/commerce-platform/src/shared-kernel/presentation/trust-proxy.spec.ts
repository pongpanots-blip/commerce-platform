import { applyTrustProxy } from './trust-proxy';

describe('applyTrustProxy', () => {
  it('trusts TRUST_PROXY_HOPS hops whether or not MCP is on (public rate limits key on the client IP)', () => {
    const http = { set: jest.fn() };
    applyTrustProxy(http, { TRUST_PROXY_HOPS: '1' });
    expect(http.set).toHaveBeenCalledWith('trust proxy', 1);
  });
  it('leaves Express alone without a positive hop count', () => {
    const http = { set: jest.fn() };
    for (const v of [undefined, '', '0', 'x']) applyTrustProxy(http, { TRUST_PROXY_HOPS: v });
    expect(http.set).not.toHaveBeenCalled();
  });
});
