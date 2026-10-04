/**
 * Redis / BullMQ configuration for the Commerce Platform.
 *
 * `QUEUES` is the single source of truth for queue names so producers and
 * `@Processor` workers can never drift apart.
 */
export const QUEUES = {
  WEBHOOK: 'webhook',
  WEBHOOK_OUT: 'webhook-out',
  SYNC: 'sync-job',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * BullMQ's default is ONE attempt, so jobs that throw to "let BullMQ retry"
 * must be enqueued with these. 5 attempts, 30s → 60s → 2m → 4m backoff — keep
 * `attempts` equal to the workers' MAX_ATTEMPTS so the row flips to 'failed'
 * on the last try.
 */
export const RETRY_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
} as const;

/**
 * Outbound deliveries to platforms (josh). A platform being down for a deploy
 * or restart must not cost it data, and it must catch up the moment it is back:
 * retry after 1s, 2s, 4s … capped at 60s, for ~3 hours before dead-letter.
 * Workers on QUEUES.WEBHOOK_OUT use {@link deliveryBackoff}.
 */
export const DELIVERY_MAX_ATTEMPTS = 200;
export const DELIVERY_JOB_OPTIONS = {
  attempts: DELIVERY_MAX_ATTEMPTS,
  backoff: { type: 'custom' },
} as const;
export const deliveryBackoff = (attemptsMade: number): number => Math.min(1000 * 2 ** Math.max(attemptsMade - 1, 0), 60_000);

export interface RedisConnection {
  host: string;
  port: number;
  password?: string;
}

export function buildRedisConnection(env: NodeJS.ProcessEnv): RedisConnection {
  return {
    host: env.REDIS_HOST || 'localhost',
    port: Number(env.REDIS_PORT || 6379),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  };
}
