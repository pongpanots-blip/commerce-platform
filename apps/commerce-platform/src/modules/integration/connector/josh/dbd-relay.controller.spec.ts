import { DbdRelayController } from './dbd-relay.controller';

const res = () => {
  const r = { headers: {} as Record<string, string>, code: 0, body: undefined as unknown,
    setHeader: (k: string, v: string) => { r.headers[k] = v; }, status: (c: number) => { r.code = c; return r; }, json: (b: unknown) => { r.body = b; return r; } };
  return r;
};
const N = '0107536000391';
const OK = { status: { code: '1000' }, data: [{ x: 1 }] };

describe('DbdRelayController', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const setup = (cached: unknown) => {
    const repo = { findOneBy: jest.fn(async () => cached), upsert: jest.fn(async () => undefined) };
    return { c: new DbdRelayController(repo as never), repo };
  };

  it('relays DBD\'s answer with the marker and keeps it', async () => {
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => OK })) as never;
    const { c, repo } = setup(null);
    const r = res();
    await c.lookup(N, r as never);
    expect([r.code, r.headers['x-dbd-relay'], r.body]).toEqual([200, '1', OK]);
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ registerNumber: N, httpStatus: 200, body: OK }), ['registerNumber']);
  });

  it('a lookup from the last 24 h is answered without DBD', async () => {
    global.fetch = jest.fn() as never;
    const { c } = setup({ registerNumber: N, httpStatus: 404, body: null, fetchedAt: new Date() });
    const r = res();
    await c.lookup(N, r as never);
    expect([r.code, r.headers['x-dbd-relay']]).toEqual([404, '1']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('DBD down: the last copy if any, otherwise 502 without the marker (josh goes direct)', async () => {
    global.fetch = jest.fn(async () => { throw new Error('timeout'); }) as never;
    const stale = setup({ registerNumber: N, httpStatus: 200, body: OK, fetchedAt: new Date(0) });
    const r1 = res();
    await stale.c.lookup(N, r1 as never);
    expect([r1.code, r1.headers['x-dbd-relay'], r1.body]).toEqual([200, '1', OK]);
    const none = setup(null);
    const r2 = res();
    await none.c.lookup(N, r2 as never);
    expect([r2.code, r2.headers['x-dbd-relay']]).toEqual([502, undefined]);
  });
});
