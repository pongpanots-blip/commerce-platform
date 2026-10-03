export interface CronJobConfig {
  expression: string;
  enabled: boolean;
  timeZone?: string;
}

export interface CronConfig {
  marketingResearch: CronJobConfig;
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
  });
}

export const cronConfig = loadCronConfig();
