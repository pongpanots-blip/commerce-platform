import { BadRequestException, UnauthorizedException } from '@nestjs/common';
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
  it('only accepts order or customer', () => {
    expect(() => new JoshBackfillController().backfill({ group: 'stock' })).toThrow(BadRequestException);
  });
});
