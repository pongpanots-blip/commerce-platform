import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { verifyJoshSignature } from './josh-events.signature';

describe('verifyJoshSignature', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });
  const body = '{"type":"order.snapshot","aggregateId":"o1"}';

  it('accepts the HMAC of the exact raw body', () => {
    process.env.JOSH_EVENTS_SECRET = 'k';
    expect(() => verifyJoshSignature(body, createHmac('sha256', 'k').update(body).digest('hex'))).not.toThrow();
  });

  it('rejects a wrong or missing signature', () => {
    process.env.JOSH_EVENTS_SECRET = 'k';
    expect(() => verifyJoshSignature(body, 'ab')).toThrow(UnauthorizedException);
    expect(() => verifyJoshSignature(body, undefined)).toThrow(UnauthorizedException);
  });

  it('fails closed in production without a secret', () => {
    delete process.env.JOSH_EVENTS_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => verifyJoshSignature(body, 'x')).toThrow(UnauthorizedException);
  });
});
