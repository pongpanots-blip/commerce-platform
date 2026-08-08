/**
 * Redis / BullMQ configuration for the Commerce Platform.
 *
 * `QUEUES` is the single source of truth for queue names so producers and
 * `@Processor` workers can never drift apart.
 */
export const QUEUES = {
  WEBHOOK: 'webhook',
  WEBHOOK_OUT: 'webhook-out',
  OUTBOX: 'outbox',
  SYNC: 'sync-job',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

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
