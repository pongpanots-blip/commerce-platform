export interface CronJobConfig {
  expression: string;
  enabled: boolean;
  timeZone?: string;
}

export interface CronConfig {
  marketingResearch: CronJobConfig;
  joshCatalogSync: CronJobConfig;
  competitorPricesRefresh: CronJobConfig;
  joshCustomerMetrics: CronJobConfig;
}

function cronEnabled(name: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name];
  if (raw !== undefined && raw.trim() !== '') {
    const v = raw.trim().toLowerCase();
    return v !== 'false' && v !== '0';
  }
  return true;
}

export function loadCronConfig(env: NodeJS.ProcessEnv = process.env): Readonly<CronConfig> {
  return Object.freeze({
    marketingResearch: {
      expression: env.CRON_MARKETING_RESEARCH ?? '* * * * *',
      enabled: cronEnabled('CRON_MARKETING_RESEARCH_ENABLED', env),
      timeZone: 'Asia/Bangkok',
    },
    // Runs only when JOSH_DATABASE_URL is set (see JoshCatalogSyncService).
    joshCatalogSync: {
      expression: env.CRON_JOSH_CATALOG_SYNC ?? '*/15 * * * *',
      enabled: cronEnabled('CRON_JOSH_CATALOG_SYNC_ENABLED', env),
      timeZone: 'Asia/Bangkok',
    },
    // Off until cutover: josh still runs its own copy of this job until then.
    // Task 9 offload. Opt-in; runs before josh's own 03:00 reconcile so josh can see it is fresh and skip.
    joshCustomerMetrics: {
      expression: env.CRON_JOSH_CUSTOMER_METRICS ?? '30 2 * * *',
      enabled: env.CRON_JOSH_CUSTOMER_METRICS_ENABLED?.trim().toLowerCase() === 'true',
      timeZone: 'Asia/Bangkok',
    },
    competitorPricesRefresh: {
      expression: env.CRON_COMPETITOR_PRICES_REFRESH ?? '0 3 * * *',
      enabled: env.CRON_COMPETITOR_PRICES_REFRESH_ENABLED?.trim().toLowerCase() === 'true',
      timeZone: 'Asia/Bangkok',
    },
  });
}

export const cronConfig = loadCronConfig();
