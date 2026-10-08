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

// --- App gap endpoints (saleactivity screens that had no API) ---

/** What `winback_app_record.kind` holds. One generic table: app-owned records, no new business tables. */
export enum WinbackAppRecordKind {
  SIGNAL_ACTION = 'signal_action',
  ACTIVITY_DRAFT = 'activity_draft',
  COACHING_TASK = 'coaching_task',
  TEAM = 'team',
  WORK_PLAN = 'work_plan',
  SAVED_PLACE = 'saved_place',
  DISCOVERY_QUERY = 'discovery_query',
  APPOINTMENT_PLAN = 'appointment_plan',
  VISIT_COMPLETION = 'visit_completion',
  VISIT_START_EVIDENCE = 'visit_start_evidence',
  JOINT_VISIT = 'joint_visit',
  SYNC_RUN = 'sync_run',
  QUOTE = 'quote',
  QUOTE_DISPATCH = 'quote_dispatch',
  QUOTE_TERMS_CATALOG = 'quote_terms_catalog',
  DAILY_REPORT = 'daily_report',
}

/** Revenue-signal kinds. Only `reactivate` / `prevent` are computed today (from the reorder baseline). */
export enum WinbackSignalType {
  REACTIVATE = 'reactivate',
  PREVENT = 'prevent',
  GROW = 'grow',
  DISCOVER = 'discover',
}

export enum WinbackSignalStatus {
  OPEN = 'open',
  COMPLETED = 'completed',
  DISMISSED = 'dismissed',
}

/** Opportunity list tabs. */
export enum WinbackOpportunityTab {
  RECOMMENDED = 'recommended',
  NEAR_WAREHOUSE = 'near_warehouse',
  NEEDS_ENRICH = 'needs_enrich',
}

export enum WinbackOpportunitySegment {
  PREMIUM_CASUAL = 'premium_casual',
  FINE_DINING = 'fine_dining',
  HOTEL = 'hotel',
  STEAKHOUSE = 'steakhouse',
  FRENCH = 'french',
  ITALIAN = 'italian',
  JAPANESE_PREMIUM = 'japanese_premium',
  BAKERY_CAFE = 'bakery_cafe',
}

/** Work plan: preparation steps and the next action (also used by visit completion / drafts). */
export enum WinbackWorkPlanStep {
  CONTACT = 'contact',
  OBJECTIVE = 'objective',
  MATERIALS = 'materials',
  FOLLOW_UP = 'follow_up',
}

export enum WinbackNextAction {
  PREPARE_VISIT = 'prepare_visit',
  FOLLOW_UP = 'follow_up',
  NEW_APPOINTMENT = 'new_appointment',
  QUOTE_REVIEW = 'quote_review',
  REVIEW_HISTORY = 'review_history',
}

export enum WinbackProductReaction {
  INTERESTED = 'interested',
  SAMPLED = 'sampled',
  CONSIDERING = 'considering',
  NOT_INTERESTED = 'not_interested',
}

export enum WinbackAppointmentPlace {
  STOREFRONT = 'storefront',
  JOSH_OFFICE = 'josh_office',
  ONLINE = 'online',
  OTHER = 'other',
}

export enum WinbackAppointmentPurpose {
  PRODUCT_INTRO = 'product_intro',
  QUOTE = 'quote',
  CONTRACT = 'contract',
  FOLLOW_UP = 'follow_up',
  CLOSE = 'close',
  OTHER = 'other',
}

/** `expired` is never stored: it is read off `valid_until`. */
export enum WinbackQuoteStatus {
  DRAFT = 'draft',
  IN_REVIEW = 'in_review',
  FOLLOW_UP = 'follow_up',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
}

/** Record-only: a dispatch is the rep's statement that they sent the quote. Nothing is sent from here. */
export enum WinbackQuoteDispatchChannel {
  EMAIL = 'email',
  LINE = 'line',
}

export enum WinbackDailyReportStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  NEEDS_REVISION = 'needs_revision',
}

export const WINBACK_APP_RECORD_KINDS = Object.values(WinbackAppRecordKind);
export const WINBACK_SIGNAL_TYPES = Object.values(WinbackSignalType);
export const WINBACK_SIGNAL_STATUSES = Object.values(WinbackSignalStatus);
export const WINBACK_OPPORTUNITY_TABS = Object.values(WinbackOpportunityTab);
export const WINBACK_OPPORTUNITY_SEGMENTS = Object.values(WinbackOpportunitySegment);
export const WINBACK_WORK_PLAN_STEPS = Object.values(WinbackWorkPlanStep);
export const WINBACK_NEXT_ACTIONS = Object.values(WinbackNextAction);
export const WINBACK_PRODUCT_REACTIONS = Object.values(WinbackProductReaction);
export const WINBACK_APPOINTMENT_PLACES = Object.values(WinbackAppointmentPlace);
export const WINBACK_APPOINTMENT_PURPOSES = Object.values(WinbackAppointmentPurpose);
export const WINBACK_QUOTE_STATUSES = Object.values(WinbackQuoteStatus);
export const WINBACK_QUOTE_DISPATCH_CHANNELS = Object.values(WinbackQuoteDispatchChannel);
export const WINBACK_DAILY_REPORT_STATUSES = Object.values(WinbackDailyReportStatus);
