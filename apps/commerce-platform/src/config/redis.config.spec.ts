import { buildRedisConnection, QUEUES, DELIVERY_JOB_OPTIONS, DELIVERY_MAX_ATTEMPTS, deliveryBackoff } from './redis.config';

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
      SYNC: 'sync-job',
    });
  });
});

describe('delivery retry (platforms must catch up fast and never lose data to a short outage)', () => {
  it('1s, 2s, 4s … capped at 60s, ~3h in total before dead-letter', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(deliveryBackoff)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    const totalMs = Array.from({ length: DELIVERY_MAX_ATTEMPTS - 1 }, (_, i) => deliveryBackoff(i + 1)).reduce((a, b) => a + b, 0);
    expect(totalMs / 3_600_000).toBeGreaterThan(3);
    expect(DELIVERY_JOB_OPTIONS).toEqual({ attempts: DELIVERY_MAX_ATTEMPTS, backoff: { type: 'custom' } });
  });
});
