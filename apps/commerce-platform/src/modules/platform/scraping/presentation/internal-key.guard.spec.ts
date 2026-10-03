import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InternalKeyGuard } from './internal-key.guard';
import { ReadProductDto } from './scraping-internal.controller';

const ctx = (key?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: key ? { 'x-internal-key': key } : {} }) }) }) as ExecutionContext;

describe('InternalKeyGuard (josh → commerce scraping API)', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  it('accepts the exact key, rejects wrong / missing', () => {
    process.env = { ...OLD, COMMERCE_INTERNAL_KEY: 'internal-secret' };
    const guard = new InternalKeyGuard();
    expect(guard.canActivate(ctx('internal-secret'))).toBe(true);
    expect(() => guard.canActivate(ctx('internal-secreT'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
  });

  it('fails closed in production when the key is not configured', () => {
    process.env = { ...OLD, NODE_ENV: 'production' };
    delete process.env.COMMERCE_INTERNAL_KEY;
    expect(() => new InternalKeyGuard().canActivate(ctx('anything'))).toThrow(UnauthorizedException);
  });
});

describe('ReadProductDto', () => {
  it('requires a uuid sourceId and a url (so the global whitelist pipe keeps them)', async () => {
    expect(await validate(plainToInstance(ReadProductDto, {
      sourceId: '00000000-0000-4000-8000-000000000651', url: 'https://www.bigc.co.th/p/1',
    }))).toEqual([]);
    const props = (await validate(plainToInstance(ReadProductDto, { sourceId: 'x' }))).map((e) => e.property).sort();
    expect(props).toEqual(['sourceId', 'url']);
  });
});
