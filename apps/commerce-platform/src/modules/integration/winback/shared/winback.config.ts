/**
 * The josh config winback reads (josh `config/cron.config.ts` + `config/app.config.ts`), same env
 * names and defaults. Commerce runs the three notify crons only once it owns winback
 * (WINBACK_OWNER=commerce) — while josh owns it, josh's crons send and these stay off.
 */
const env = process.env;
const cronOn = (name: string) => winbackOwnedByCommerce() && ['true', '1', 'on'].includes((env[name] ?? '').trim().toLowerCase());
const intEnv = (name: string, fallback: number) => {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

/** Who runs winback: `josh` (default — commerce mirrors josh's tables, read-only) or `commerce` (commerce writes, notifies, mirrors back). */
export function winbackOwnedByCommerce(): boolean {
  return (process.env.WINBACK_OWNER ?? '').trim().toLowerCase() === 'commerce';
}

interface CronJobConfig { expression: string; enabled: boolean; timeZone?: string }
export const cronConfig: { winbackAppointmentsDue: CronJobConfig; winbackDailyDigest: CronJobConfig; winbackAgingLeads: CronJobConfig } = {
  winbackAppointmentsDue: { expression: env.CRON_WINBACK_APPOINTMENTS_DUE?.trim() || '*/10 * * * *', enabled: cronOn('CRON_WINBACK_APPOINTMENTS_DUE_ENABLED') },
  winbackDailyDigest: { expression: env.CRON_WINBACK_DAILY_DIGEST?.trim() || '0 18 * * *', enabled: cronOn('CRON_WINBACK_DAILY_DIGEST_ENABLED'), timeZone: 'Asia/Bangkok' },
  winbackAgingLeads: { expression: env.CRON_WINBACK_AGING_LEADS?.trim() || '0 8 * * *', enabled: cronOn('CRON_WINBACK_AGING_LEADS_ENABLED'), timeZone: 'Asia/Bangkok' },
};

export const appConfig = {
  winback: {
    appointmentReminderMinutes: intEnv('WINBACK_APPOINTMENT_REMINDER_MINUTES', 60),
    leadAgingDays: intEnv('WINBACK_LEAD_AGING_DAYS', 3),
  },
};

/** Legacy sign-in stays on until the account/link cutover is complete. */
export function acceptsJoshJwt(): boolean {
  return !['false', '0', 'off'].includes((process.env.WINBACK_ACCEPT_JOSH_JWT ?? '').trim().toLowerCase());
}
