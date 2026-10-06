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
  joshBestsellers: CronJobConfig;
  jagotaShadow: CronJobConfig;
  priceShadow: CronJobConfig;
  staffPricesImport: CronJobConfig;
  jagotaSyncImport: CronJobConfig;
  joshOrderCopy: CronJobConfig;
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
    // Task 9 offload. Opt-in; josh keeps each push for 1h, so a 10-minute cadence leaves room for misses.
    joshBestsellers: {
      expression: env.CRON_JOSH_BESTSELLERS ?? '0 */10 * * * *',
      enabled: env.CRON_JOSH_BESTSELLERS_ENABLED?.trim().toLowerCase() === 'true',
      timeZone: 'Asia/Bangkok',
    },
    // Shadow mode for orders → Jagota through commerce: compare josh's sends with commerce's build. Opt-in; sends nothing.
    jagotaShadow: {
      expression: env.CRON_JAGOTA_SHADOW ?? '30 * * * * *',
      enabled: env.CRON_JAGOTA_SHADOW_ENABLED?.trim().toLowerCase() === 'true',
      timeZone: 'Asia/Bangkok',
    },
    // Shadow mode for "commerce owns prices": re-price josh's new order lines with josh's resolver (copied) and compare. Opt-in; reads only.
    priceShadow: {
      expression: env.CRON_PRICE_SHADOW ?? '45 */5 * * * *',
      enabled: env.CRON_PRICE_SHADOW_ENABLED?.trim().toLowerCase() === 'true',
      timeZone: 'Asia/Bangkok',
    },
    // Import josh's customer / contract prices into commerce's staff_prices (rows josh creates itself: ERP quotations, CS requests). Opt-in.
    staffPricesImport: {
      expression: env.CRON_STAFF_PRICES_IMPORT ?? '15 */10 * * * *',
      enabled: env.CRON_STAFF_PRICES_IMPORT_ENABLED?.trim().toLowerCase() === 'true',
      timeZone: 'Asia/Bangkok',
    },
    // Copy josh's ERP send history (jagota_order_sync) into commerce (orders → Jagota step 3). Opt-in; reads josh only.
    jagotaSyncImport: {
      expression: env.CRON_JAGOTA_SYNC_IMPORT ?? '30 */5 * * * *',
      enabled: env.CRON_JAGOTA_SYNC_IMPORT_ENABLED?.trim().toLowerCase() === 'true',
      timeZone: 'Asia/Bangkok',
    },
    // Checkout shadow quote: rebuild each new josh order's totals with josh's checkout math (copied) and compare. Opt-in; reads only.
    // Checkout step 2: commerce's copy of every josh order (backfill + refresh of orders that can still change). Opt-in; reads josh only.
    joshOrderCopy: {
      expression: env.CRON_JOSH_ORDER_COPY ?? '20 */2 * * * *',
      enabled: env.CRON_JOSH_ORDER_COPY_ENABLED?.trim().toLowerCase() === 'true',
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
