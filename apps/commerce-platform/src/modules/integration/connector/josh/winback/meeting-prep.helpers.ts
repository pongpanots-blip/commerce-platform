/**
 * Pure helpers behind `GET /winback/lead-signals` and the meeting-prep
 * acknowledgements. Kept out of the service so the arithmetic that the Monday
 * screen depends on is unit-testable without a database.
 */
import { WinbackMeetingSignal, WinbackStage } from './winback.enums';

/** How much of an activity note the screen shows under a talking point. */
export const LAST_NOTE_MAX_CHARS = 200;

/** Window whose completed stage transitions feed `stage_median_days`. */
export const STAGE_MEDIAN_WINDOW_DAYS = 90;

/**
 * Completed transitions a rep needs in a stage before their median is a number
 * rather than `null`. Below this the app renders "ยังไม่พอประเมิน": a median of
 * two negotiations draws the same bold bar as a median of fifty, and accuses
 * someone on the strength of two data points.
 */
export const STAGE_MEDIAN_MIN_SAMPLES = 5;

/**
 * `winback_stage_history.changed_by` when a Josh sync moved the stage and the
 * account had no owner. Not a rep — excluded from per-rep timing.
 */
export const SYNC_STAGE_ACTOR = '00000000-0000-0000-0000-000000000001';

/**
 * How far back stage history is loaded. Wider than the median window on
 * purpose: a transition that *ended* inside the window may have *started*
 * before it, and without the earlier row its duration cannot be measured.
 */
export const STAGE_HISTORY_LOOKBACK_DAYS = 180;

const DAY_MS = 86_400_000;

/** Stages a lead is no longer worked in — never discussed at the meeting. */
export const CLOSED_WINBACK_STAGES: readonly string[] = [
  WinbackStage.REJECTED,
  WinbackStage.LOST,
  WinbackStage.WON,
  WinbackStage.SIGNED,
  WinbackStage.REACTIVATED,
  WinbackStage.ORDERING_AGAIN,
];

/** Signals whose `subject_id` identifies something narrower than the lead. */
const SIGNALS_REQUIRING_SUBJECT: readonly WinbackMeetingSignal[] = [
  WinbackMeetingSignal.APPOINTMENT_UNLOGGED,
  WinbackMeetingSignal.STAGE_STALLED,
];

export interface StageHistoryRow {
  account_id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: Date | string;
  /** Who moved the lead. Present on rows loaded for per-rep timing. */
  changed_by?: string | null;
}

/** One measured stay in a stage, and the rep who ended it. */
export interface StageTransitionSample {
  stage: string;
  days: number;
  /** `changed_by` of the row that closed the stage; null when unattributable. */
  actorId: string | null;
}

/** Trim a note to what the screen renders; `null` stays `null`. */
export function truncateNote(
  note: string | null | undefined,
  max = LAST_NOTE_MAX_CHARS,
): string | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * Every measured stay in a stage — the shared basis for both the team median
 * and the per-rep breakdown, so the two can never drift apart.
 *
 * A pair (previous → row) means the account left `row.from_stage` at
 * `row.changed_at` having entered it at `previous.changed_at`. The stay is
 * counted only when the *departure* falls inside `windowStart..windowEnd`, so
 * this measures "how long stages took recently" rather than "how long
 * currently-open leads have been sitting" — which is why it cannot be derived
 * from the leads a client holds, and has to come from the server.
 *
 * `rows` must be ordered by `account_id`, then `changed_at` ascending.
 */
export function stageTransitionSamples(
  rows: StageHistoryRow[],
  windowStart: Date,
  windowEnd: Date,
): StageTransitionSample[] {
  const samples: StageTransitionSample[] = [];
  const previousByAccount = new Map<string, StageHistoryRow>();

  for (const row of rows) {
    const previous = previousByAccount.get(row.account_id);
    previousByAccount.set(row.account_id, row);
    if (!previous || !row.from_stage) continue;

    const leftAt = new Date(row.changed_at).getTime();
    if (leftAt < windowStart.getTime() || leftAt > windowEnd.getTime()) continue;

    const days = (leftAt - new Date(previous.changed_at).getTime()) / DAY_MS;
    if (!Number.isFinite(days) || days < 0) continue;

    // Attributed to whoever moved the lead *out* of the stage — the rep who
    // worked it to the end of that stage. The account's current assignee would
    // be wrong for every lead that changed hands mid-pipeline.
    const actorId =
      row.changed_by && row.changed_by !== SYNC_STAGE_ACTOR ? row.changed_by : null;

    samples.push({ stage: row.from_stage, days, actorId });
  }

  return samples;
}

/**
 * Days spent in each stage, from consecutive history rows of the same account.
 *
 * A pair (previous → row) means the account left `row.from_stage` at
 * `row.changed_at` having entered it at `previous.changed_at`. The sample is
 * credited to `from_stage` and counted only when the *departure* falls inside
 * `windowStart..windowEnd`, so the result is "how long stages took recently"
 * rather than "how long currently-open leads have been sitting".
 *
 * `rows` must be ordered by `account_id`, then `changed_at` ascending.
 * (`AnalyticsService.buildDwell` pairs rows the same way for its mean-days
 * chart; this variant is windowed and feeds a median instead.)
 */
export function stageDurationSamples(
  rows: StageHistoryRow[],
  windowStart: Date,
  windowEnd: Date,
): Map<string, number[]> {
  const samples = new Map<string, number[]>();
  for (const sample of stageTransitionSamples(rows, windowStart, windowEnd)) {
    const bucket = samples.get(sample.stage) ?? [];
    bucket.push(sample.days);
    samples.set(sample.stage, bucket);
  }
  return samples;
}

/** Median of a non-empty numeric list; `null` when there is nothing to measure. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median days per stage, rounded to one decimal. Stages with no completed
 * transition in the window are omitted rather than sent as `null` — the app
 * falls back to its own default when a stage is missing, and a `null` would
 * just be a second way of saying the same thing.
 */
export function medianStageDays(
  rows: StageHistoryRow[],
  windowStart: Date,
  windowEnd: Date,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [stage, values] of stageDurationSamples(rows, windowStart, windowEnd)) {
    const value = median(values);
    if (value === null) continue;
    out[stage] = Math.round(value * 10) / 10;
  }
  return out;
}

/**
 * When the account entered the stage it is in now: the most recent history row
 * that moved it *into* that stage. `rows` must be ordered `changed_at`
 * descending. Returns `null` when history has no such row — leads created
 * before the history table existed, or that never moved off their first stage.
 */
export function stageEnteredAt(
  rows: StageHistoryRow[],
  currentStage: string,
): Date | null {
  for (const row of rows) {
    if (row.to_stage === currentStage) return new Date(row.changed_at);
  }
  return null;
}

/** The identity of a talking point: same triple = same point as last week. */
export function ackIdentityKey(
  accountId: string,
  signal: string,
  subjectId: string | null | undefined,
): string {
  return `${accountId}|${signal}|${subjectId ?? ''}`;
}

/**
 * Whether `signal` needs a `subject_id`. Getting this wrong is silent and
 * expensive: an unexpected subject makes a resolved point look unresolved
 * forever, a missing one makes a new appointment look like last week's.
 */
export function requiresSubjectId(signal: WinbackMeetingSignal): boolean {
  return SIGNALS_REQUIRING_SUBJECT.includes(signal);
}

/**
 * Per-rep median days per stage, over the same window and definition as
 * `medianStageDays`.
 *
 * Every rep entry carries the same stage keys as the team line, so the two can
 * be drawn against each other. A stage where the rep has fewer than
 * `minSamples` completed transitions is `null`, never a number — the app draws
 * whatever number it is given, and a median of two says nothing about a rep.
 *
 * `allowedActorIds` restricts the result (a sales user gets only their own
 * entry; a manager gets every rep).
 */
export function medianStageDaysByActor(
  rows: StageHistoryRow[],
  windowStart: Date,
  windowEnd: Date,
  stages: string[],
  options: { allowedActorIds?: Set<string>; minSamples?: number } = {},
): Record<string, Record<string, number | null>> {
  const { allowedActorIds, minSamples = STAGE_MEDIAN_MIN_SAMPLES } = options;

  const byActor = new Map<string, Map<string, number[]>>();
  for (const sample of stageTransitionSamples(rows, windowStart, windowEnd)) {
    if (!sample.actorId) continue;
    if (allowedActorIds && !allowedActorIds.has(sample.actorId)) continue;

    const stageBuckets = byActor.get(sample.actorId) ?? new Map<string, number[]>();
    const bucket = stageBuckets.get(sample.stage) ?? [];
    bucket.push(sample.days);
    stageBuckets.set(sample.stage, bucket);
    byActor.set(sample.actorId, stageBuckets);
  }

  const out: Record<string, Record<string, number | null>> = {};
  for (const [actorId, stageSamples] of byActor) {
    const row: Record<string, number | null> = {};
    for (const stage of stages) {
      const values = stageSamples.get(stage) ?? [];
      const value = values.length >= minSamples ? median(values) : null;
      row[stage] = value === null ? null : Math.round(value * 10) / 10;
    }
    out[actorId] = row;
  }
  return out;
}
