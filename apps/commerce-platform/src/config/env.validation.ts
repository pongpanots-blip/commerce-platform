/**
 * Lightweight env validation for the Commerce Platform.
 *
 * Fails fast at boot if neither a full `COMMERCE_DATABASE_URL` nor the discrete
 * `COMMERCE_DB_*` vars are present, and if Redis coordinates are missing (BullMQ
 * needs them). Kept dependency-free (no @nestjs/config) to match `apps/backend`,
 * which reads `process.env` directly.
 */
export interface CommerceEnv {
  databaseConfigured: boolean;
  redisHost: string;
  redisPort: number;
}

export function validateEnv(env: NodeJS.ProcessEnv): CommerceEnv {
  const hasUrl = Boolean(env.COMMERCE_DATABASE_URL);
  const hasDiscrete = Boolean(env.COMMERCE_DB_NAME || env.COMMERCE_DB_HOST);

  if (!hasUrl && !hasDiscrete) {
    throw new Error(
      '[commerce-platform] Missing database config: set COMMERCE_DATABASE_URL ' +
        'or COMMERCE_DB_HOST/COMMERCE_DB_NAME.',
    );
  }

  const redisHost = env.REDIS_HOST || 'localhost';
  const redisPort = Number(env.REDIS_PORT || 6379);

  if (Number.isNaN(redisPort)) {
    throw new Error('[commerce-platform] REDIS_PORT must be a number.');
  }

  return { databaseConfigured: true, redisHost, redisPort };
}
