import { WinbackLifecycle } from './winback.enums';

export type TmpStageKey =
  | 'created'
  | 'contact_1'
  | 'follow_up'
  | 'appointment'
  | 'app_loaded';

export interface TmpProgressStep {
  key: TmpStageKey;
  label: string;
  done: boolean;
}

export interface TmpProgress {
  stage: TmpStageKey;
  label: string;
  contact_count: number;
  step_index: number;
  steps: TmpProgressStep[];
}

const STAGE_ORDER: TmpStageKey[] = [
  'created',
  'contact_1',
  'follow_up',
  'appointment',
  'app_loaded',
];

const STAGE_LABEL: Record<TmpStageKey, string> = {
  created: 'สร้าง TMP',
  contact_1: 'ติดตามครั้งที่ 1',
  follow_up: 'ติดตามต่อเนื่อง',
  appointment: 'นัดหมายแล้ว',
  app_loaded: 'สมัครแอปแล้ว',
};

/**
 * Observational TMP funnel from activities / links — not a manual pipeline.
 * Furthest reached step wins (app register ends TMP).
 */
export function deriveTmpProgress(input: {
  lifecycle?: string | null;
  contactCount: number;
  hasAppointment: boolean;
  appLoaded: boolean;
}): TmpProgress {
  const contactCount = Math.max(0, input.contactCount | 0);
  const appLoaded =
    input.appLoaded || input.lifecycle === WinbackLifecycle.LEAD;

  const steps: TmpProgressStep[] = [
    { key: 'created', label: STAGE_LABEL.created, done: true },
    {
      key: 'contact_1',
      label: STAGE_LABEL.contact_1,
      done: contactCount >= 1 || appLoaded,
    },
    {
      key: 'follow_up',
      label:
        contactCount >= 2
          ? `ติดตามครั้งที่ ${contactCount}`
          : STAGE_LABEL.follow_up,
      done: contactCount >= 2 || appLoaded,
    },
    {
      key: 'appointment',
      label: STAGE_LABEL.appointment,
      done: input.hasAppointment || appLoaded,
    },
    {
      key: 'app_loaded',
      label: STAGE_LABEL.app_loaded,
      done: appLoaded,
    },
  ];

  let stage: TmpStageKey = 'created';
  for (const s of steps) {
    if (s.done) stage = s.key;
  }

  return {
    stage,
    label: steps.find((s) => s.key === stage)?.label ?? STAGE_LABEL[stage],
    contact_count: contactCount,
    step_index: STAGE_ORDER.indexOf(stage),
    steps,
  };
}

/** Cheap pool/list derivation from account columns only. */
export function deriveTmpProgressFromAccount(account: {
  lifecycle?: string | null;
  activity_count?: number | null;
  visit_count?: number | null;
  stage?: string | null;
  next_follow_up_at?: Date | string | null;
  josh_user_id?: string | null;
  josh_company_id?: string | null;
  last_app_login_at?: Date | string | null;
  app_loaded?: boolean | null;
}): TmpProgress {
  const contactCount = Math.max(
    account.activity_count ?? 0,
    account.visit_count ?? 0,
  );
  const hasAppointment =
    account.stage === 'appointment' || Boolean(account.next_follow_up_at);
  const appLoaded =
    account.lifecycle === WinbackLifecycle.LEAD ||
    Boolean(account.app_loaded) ||
    Boolean(account.last_app_login_at);
  return deriveTmpProgress({
    lifecycle: account.lifecycle,
    contactCount,
    hasAppointment,
    appLoaded,
  });
}
