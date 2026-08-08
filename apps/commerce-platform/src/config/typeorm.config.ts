import { DataSourceOptions } from 'typeorm';
import * as path from 'path';

/**
 * Builds TypeORM connection options for the Commerce Platform.
 *
 * Deliberately isolated from `apps/backend`: reads only `COMMERCE_*` env vars so
 * the two services can never share a database connection. Consumed by both the
 * NestJS `TypeOrmModule.forRootAsync` factory and the CLI `data-source.ts`.
 */
export function buildDataSourceOptions(env: NodeJS.ProcessEnv): DataSourceOptions {
  const base = {
    type: 'postgres' as const,
    entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [path.join(__dirname, '..', 'migrations', '*.{ts,js}')],
    synchronize: false,
    logging: env.COMMERCE_DB_LOGGING === 'true',
    ssl: env.COMMERCE_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };

  if (env.COMMERCE_DATABASE_URL) {
    return { ...base, url: env.COMMERCE_DATABASE_URL };
  }

  return {
    ...base,
    host: env.COMMERCE_DB_HOST || 'localhost',
    port: Number(env.COMMERCE_DB_PORT || 5432),
    username: env.COMMERCE_DB_USERNAME || 'postgres',
    password: env.COMMERCE_DB_PASSWORD || undefined,
    database: env.COMMERCE_DB_NAME || 'commerce_db',
  };
}
