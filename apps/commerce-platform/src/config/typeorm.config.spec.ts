import { buildDataSourceOptions } from './typeorm.config';

describe('buildDataSourceOptions', () => {
  it('uses the commerce-specific database, not the backend DB', () => {
    const opts = buildDataSourceOptions({
      COMMERCE_DB_HOST: 'localhost',
      COMMERCE_DB_NAME: 'commerce_db',
      COMMERCE_DB_USERNAME: 'postgres',
    } as NodeJS.ProcessEnv);

    expect(opts.type).toBe('postgres');
    expect((opts as { database?: string }).database).toBe('commerce_db');
    expect((opts as { database?: string }).database).not.toBe('webjosh_db');
  });

  it('prefers COMMERCE_DATABASE_URL when present', () => {
    const opts = buildDataSourceOptions({
      COMMERCE_DATABASE_URL: 'postgres://u:p@host:5432/commerce_db',
    } as NodeJS.ProcessEnv);

    expect((opts as { url?: string }).url).toBe('postgres://u:p@host:5432/commerce_db');
  });

  it('never enables synchronize', () => {
    const opts = buildDataSourceOptions({ COMMERCE_DB_NAME: 'commerce_db' } as NodeJS.ProcessEnv);
    expect(opts.synchronize).toBe(false);
  });
});
