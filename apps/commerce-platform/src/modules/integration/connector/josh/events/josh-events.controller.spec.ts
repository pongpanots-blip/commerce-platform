import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { JoshBackfillController, JoshEventsController } from './josh-events.controller';

describe('JoshEventsController', () => {
  const OLD = { ...process.env };
  beforeEach(() => { process.env.JOSH_EVENTS_SECRET = 'k'; });
  afterEach(() => { process.env = { ...OLD }; });
  const env = { type: 'order.snapshot', aggregateId: 'o1', version: '2', occurredAt: 'x', data: {} };
  const raw = JSON.stringify(env);
  const sig = createHmac('sha256', 'k').update(raw).digest('hex');

  it('verifies the raw body, then applies', async () => {
    const service = { apply: jest.fn().mockResolvedValue('applied') };
    const c = new JoshEventsController(service as never);
    expect(await c.receive({ rawBody: Buffer.from(raw), body: env } as never, sig)).toEqual({ received: true, result: 'applied' });
    expect(service.apply).toHaveBeenCalledWith(env);
  });

  it('rejects a body that does not match its signature', async () => {
    const service = { apply: jest.fn() };
    const c = new JoshEventsController(service as never);
    await expect(c.receive({ rawBody: Buffer.from(raw + ' '), body: env } as never, sig)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.apply).not.toHaveBeenCalled();
  });
});

describe('JoshBackfillController', () => {
  it('only accepts order, customer or catalog', () => {
    expect(() => new JoshBackfillController().backfill({ group: 'stock' })).toThrow(BadRequestException);
    // catalog passes the group check and only then needs the josh API config.
    const prev = { url: process.env.JOSH_API_URL, secret: process.env.JOSH_EVENTS_SECRET };
    delete process.env.JOSH_API_URL; delete process.env.JOSH_EVENTS_SECRET;
    try {
      expect(() => new JoshBackfillController().backfill({ group: 'catalog' })).toThrow(ServiceUnavailableException);
    } finally { Object.assign(process.env, prev.url ? { JOSH_API_URL: prev.url } : {}, prev.secret ? { JOSH_EVENTS_SECRET: prev.secret } : {}); }
  });
});
