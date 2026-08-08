import { buildRedisConnection, QUEUES } from './redis.config';

describe('buildRedisConnection', () => {
  it('defaults to localhost:6379', () => {
    const conn = buildRedisConnection({} as NodeJS.ProcessEnv);
    expect(conn.host).toBe('localhost');
    expect(conn.port).toBe(6379);
  });

  it('reads REDIS_HOST/REDIS_PORT and omits password when unset', () => {
    const conn = buildRedisConnection({ REDIS_HOST: 'r', REDIS_PORT: '6380' } as NodeJS.ProcessEnv);
    expect(conn.host).toBe('r');
    expect(conn.port).toBe(6380);
    expect('password' in conn).toBe(false);
  });
});

describe('QUEUES', () => {
  it('exposes stable queue names', () => {
    expect(QUEUES).toEqual({
      WEBHOOK: 'webhook',
      WEBHOOK_OUT: 'webhook-out',
      OUTBOX: 'outbox',
      SYNC: 'sync-job',
    });
  });
});
