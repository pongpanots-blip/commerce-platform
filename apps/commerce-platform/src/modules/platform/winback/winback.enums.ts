export enum WinbackSource {
  JOSH = 'josh',
  IMPORT = 'import',
  BOTH = 'both',
  MANUAL = 'manual',
}

export enum WinbackHealth {
  DORMANT = 'dormant',
  WATCH = 'watch',
  REACTIVATING = 'reactivating',
  ACTIVE_AGAIN = 'active_again',
}

export enum WinbackStage {
  PROSPECT = 'prospect',
  INACTIVE_POOL = 'inactive_pool',
  CONTACTED = 'contacted',
  APPOINTMENT = 'appointment',
  NEGOTIATE = 'negotiate',
  INTERESTED = 'interested',
  SIGNED = 'signed',
  WON = 'won',
  REACTIVATED = 'reactivated',
  ORDERING_AGAIN = 'ordering_again',
  REJECTED = 'rejected',
  LOST = 'lost',
}

export enum WinbackLeadSource {
  FACEBOOK = 'facebook',
  TIKTOK = 'tiktok',
  WEBSITE = 'website',
  REFERRAL = 'referral',
  WALK_IN = 'walk_in',
  MARKET_EXPLORER = 'market_explorer',
  OTHER = 'other',
}

export enum WinbackCustomerType {
  B2B_COMPANY = 'b2b_company',
  B2B_INDIVIDUAL = 'b2b_individual',
}

export enum WinbackBusinessSize {
  STANDALONE = 'standalone',
  MINI_CHAIN = 'mini_chain',
}

export enum WinbackContactTeam {
  PURCHASING = 'purchasing',
  ACCOUNTANT = 'accountant',
  OTHER = 'other',
}

export enum WinbackRejectReason {
  PRICE = 'price',
  SERVICE = 'service',
  QUALITY = 'quality',
  BUSINESS_CLOSED = 'business_closed',
  OTHER = 'other',
}

/** Capture phase: tmp until Josh app registration, then full lead. */
export enum WinbackLifecycle {
  TMP = 'tmp',
  LEAD = 'lead',
}

export enum WinbackActivityType {
  VISIT = 'visit',
  CALL = 'call',
  COLD_CALL = 'cold_call',
  LINE = 'line',
  MEETING = 'meeting',
  PITCHING = 'pitching',
  STORE_VISIT = 'store_visit',
  TRAINING = 'training',
  /** ส่งของขวัญ / ส่งมอบของหน้างาน */
  GIFT = 'gift',
  /** ส่งของ / ส่งเอกสาร */
  DELIVERY = 'delivery',
  /** ขอ feedback */
  FEEDBACK = 'feedback',
  NOTE = 'note',
}

export enum WinbackActivityOutcome {
  INTERESTED = 'interested',
  NOT_INTERESTED = 'not_interested',
  NO_ANSWER = 'no_answer',
  FOLLOW_UP = 'follow_up',
  ORDERED = 'ordered',
}

/**
 * Talking-point kinds the Monday meeting-prep screen acknowledges. The app owns
 * the wording and the ranking; the backend only stores "this point was raised",
 * so an unknown value here means a client typo and is rejected, never stored.
 */
export enum WinbackMeetingSignal {
  /** A planned appointment whose scheduled time passed with no outcome logged. */
  APPOINTMENT_UNLOGGED = 'appointment_unlogged',
  /** Sat in one pipeline stage far longer than the team median. */
  STAGE_STALLED = 'stage_stalled',
  /** Assigned but never worked. */
  NEVER_TOUCHED = 'never_touched',
  /** Worked once, then no activity for a long time. */
  WENT_QUIET = 'went_quiet',
}

export const WINBACK_SOURCES = Object.values(WinbackSource);
export const WINBACK_HEALTHS = Object.values(WinbackHealth);
export const WINBACK_STAGES = Object.values(WinbackStage);
export const WINBACK_LIFECYCLES = Object.values(WinbackLifecycle);
export const WINBACK_ACTIVITY_TYPES = Object.values(WinbackActivityType);
export const WINBACK_ACTIVITY_OUTCOMES = Object.values(WinbackActivityOutcome);
export const WINBACK_LEAD_SOURCES = Object.values(WinbackLeadSource);
export const WINBACK_CUSTOMER_TYPES = Object.values(WinbackCustomerType);
export const WINBACK_BUSINESS_SIZES = Object.values(WinbackBusinessSize);
export const WINBACK_CONTACT_TEAMS = Object.values(WinbackContactTeam);
export const WINBACK_REJECT_REASONS = Object.values(WinbackRejectReason);
export const WINBACK_MEETING_SIGNALS = Object.values(WinbackMeetingSignal);
