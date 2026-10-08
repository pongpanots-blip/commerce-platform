// DTOs for the saleactivity screens that had no API (opportunities, revenue signals, catalog, visit/appointment
// extras, drafts, coaching, teams, work plan / saved places / discovery, sync history, commercial record-keeping).
// snake_case in, like every winback DTO; responses are camelCased by WinbackResponseInterceptor.
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  WINBACK_ACTIVITY_OUTCOMES,
  WINBACK_ACTIVITY_TYPES,
  WINBACK_APPOINTMENT_PLACES,
  WINBACK_COLLAB_LOG_EVENTS,
  WINBACK_COLLAB_REQUEST_KINDS,
  WINBACK_APPOINTMENT_PURPOSES,
  WINBACK_DAILY_REPORT_STATUSES,
  WINBACK_NEXT_ACTIONS,
  WINBACK_OPPORTUNITY_PURPOSES,
  WINBACK_OPPORTUNITY_SEGMENTS,
  WINBACK_OPPORTUNITY_TABS,
  WINBACK_PRODUCT_REACTIONS,
  WINBACK_QUOTE_DISPATCH_CHANNELS,
  WINBACK_QUOTE_STATUSES,
  WINBACK_RECOMMENDATION_REASONS,
  WINBACK_SIGNAL_STATUSES,
  WINBACK_STAGES,
  WINBACK_WORK_PLAN_STEPS,
  WinbackActivityOutcome,
  WinbackCollabRequestStatus,
} from '../winback.enums';

/** `a,b,c` (or a repeated query key) → `['a','b','c']`; empty → undefined. */
function toList({ value }: { value: unknown }): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const out = raw.map((v) => String(v).trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function toOptionalBoolean({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

const UUID_LIST_MAX = 200;
const NEXT_ACTION_OR_NULL = (_: unknown, v: unknown) => v !== null;

// --- Opportunities ---

export class OpportunityQueryDto {
  /** `TH-10,TH-11` (or bare `10,11`). */
  @IsOptional() @Transform(toList) @IsArray() @ArrayMaxSize(77) @Matches(/^(TH-)?\d{2}$/i, { each: true }) province_codes?: string[];
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) min_spend?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) min_premium_fit?: number;
  @IsOptional() @Transform(toList) @IsArray() @IsIn(WINBACK_OPPORTUNITY_SEGMENTS, { each: true }) segments?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) max_road_km?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) max_delivery_ratio?: number;
  /** Accepted for the app's query shape; not used until a delivery-cost source exists. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) expected_order_value?: number;
  @IsOptional() @IsIn(WINBACK_OPPORTUNITY_TABS) tab?: string;
  @IsOptional() @IsIn(['sales_priority_desc']) sort?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  // §4.11.8 filter metadata — applied in SQL before the candidate cap, pagination and tab counts.
  @IsOptional() @IsIn(WINBACK_STAGES) stage?: string;
  @IsOptional() @IsIn(WINBACK_OPPORTUNITY_PURPOSES) purpose?: string;
  @IsOptional() @IsIn(WINBACK_RECOMMENDATION_REASONS) recommendation?: string;
  /** Coordination owner. A sales user may only pass their own id (403 otherwise). */
  @IsOptional() @IsUUID() owner_sales_user_id?: string;
  /** Only opportunities with no owner; 400 together with `owner_sales_user_id`. */
  @IsOptional() @Transform(toOptionalBoolean) @IsBoolean() unassigned_only?: boolean;
}

export class OpportunityProvinceQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

// --- Opportunity filter metadata + collaboration (§4.11.8, record-only) ---

export class UpdateOpportunityMetaDto {
  /** At least one of `stage` / `purpose`. Record-only: a converted account's own stage is not touched. */
  @IsOptional() @IsIn(WINBACK_STAGES) stage?: string;
  @IsOptional() @IsIn(WINBACK_OPPORTUNITY_PURPOSES) purpose?: string;
  /** The `version` the caller last read (0 = nothing stored yet); 409 when it moved on. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expected_version?: number;
}

export class CreateCollabRequestDto {
  @IsIn(WINBACK_COLLAB_REQUEST_KINDS) kind: string;
  @IsUUID() recipient_id: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason: string;
}

/** `approved` / `rejected`: the recipient or a manager · `cancelled`: the requester or a manager. */
export const COLLAB_RESOLUTIONS = [
  WinbackCollabRequestStatus.APPROVED,
  WinbackCollabRequestStatus.REJECTED,
  WinbackCollabRequestStatus.CANCELLED,
];

export class ResolveCollabRequestDto {
  @IsIn(COLLAB_RESOLUTIONS) status: string;
  @IsString() @MinLength(1) @MaxLength(1000) note: string;
}

export class CollabMessageDto {
  @IsUUID() recipient_id: string;
  @IsString() @MinLength(1) @MaxLength(1000) text: string;
  @IsOptional() @IsBoolean() is_call_note?: boolean;
}

/** `YYYY-MM-DD` (a Bangkok day) or an ISO date-time that carries its zone (`Z` / `±hh:mm`). */
const DAY_OR_ZONED_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** Collaboration audit log paging (manager only): newest first. */
export class CollabLogPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class CollabLogQueryDto extends CollabLogPageDto {
  @IsOptional() @IsUUID() opportunity_id?: string;
  @IsOptional() @IsUUID() actor_id?: string;
  @IsOptional() @IsUUID() target_user_id?: string;
  /** Actor OR target. */
  @IsOptional() @IsUUID() user_id?: string;
  /** `request_created,owner_changed` (or a repeated key). */
  @IsOptional() @Transform(toList) @IsArray() @ArrayMaxSize(20) @IsIn(WINBACK_COLLAB_LOG_EVENTS, { each: true }) event?: string[];
  /** Inclusive; a day is read in Bangkok (`to` = through the end of that day). */
  @IsOptional() @Matches(DAY_OR_ZONED_ISO, { message: 'from must be YYYY-MM-DD or an ISO date-time with a zone' }) from?: string;
  @IsOptional() @Matches(DAY_OR_ZONED_ISO, { message: 'to must be YYYY-MM-DD or an ISO date-time with a zone' }) to?: string;
}

// --- Revenue signals ---

export class SignalQueryDto {
  @IsOptional() @IsIn(WINBACK_SIGNAL_STATUSES) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 15;
  /** Manager only; ignored for a sales user (forced to self). */
  @IsOptional() @IsUUID() sales_user_id?: string;
}

/** `ordered` is not a signal outcome: an order closes the signal by itself (the next sync sees it). */
export const SIGNAL_COMPLETE_OUTCOMES = WINBACK_ACTIVITY_OUTCOMES.filter((o) => o !== WinbackActivityOutcome.ORDERED);

export class CompleteSignalDto {
  @IsIn(SIGNAL_COMPLETE_OUTCOMES) outcome: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class SnoozeSignalDto {
  /** `YYYY-MM-DD` (or a full ISO time); must be after today. */
  @IsISO8601() until: string;
}

export class DismissSignalDto {
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}

// --- Product catalog ---

export class ProductQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit = 500;
}

// --- Visit completion / start evidence / appointment plan ---

export class PlannedProductDto {
  @IsString() @MinLength(1) @MaxLength(64) product_id: string;
  @IsString() @MaxLength(100) sku: string;
  @IsString() @MaxLength(500) name: string;
  @IsString() @MinLength(1) @MaxLength(64) unit_id: string;
  @IsString() @MaxLength(100) unit_label: string;
  @Type(() => Number) @IsNumber() @Min(0.0001) @Max(100000) quantity: number;
}

export class PresentedProductDto extends PlannedProductDto {
  @IsIn(WINBACK_PRODUCT_REACTIONS) reaction: string;
}

export class VisitCompletionDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PresentedProductDto) products: PresentedProductDto[];
  @IsOptional() @IsUUID() quote_id?: string | null;
  @IsOptional() @IsString() @MaxLength(200) quote_label?: string | null;
  /** `next_action` and `follow_up_at` go together (both or neither). */
  @IsOptional() @ValidateIf(NEXT_ACTION_OR_NULL) @IsIn(WINBACK_NEXT_ACTIONS) next_action?: string | null;
  @IsOptional() @ValidateIf(NEXT_ACTION_OR_NULL) @IsISO8601() follow_up_at?: string | null;
}

export class VisitStartEvidenceDto {
  @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @MaxLength(2000, { each: true }) photo_urls: string[];
}

export class AppointmentPlanDto {
  @IsIn(WINBACK_APPOINTMENT_PLACES) place_code: string;
  @IsOptional() @IsString() @MaxLength(500) place_detail?: string;
  @IsIn(WINBACK_APPOINTMENT_PURPOSES) purpose_code: string;
  @IsString() @MinLength(1) @MaxLength(300) objective: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PlannedProductDto) products?: PlannedProductDto[];
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) prepared_product_ids?: string[];
  @IsOptional() @IsBoolean() documents_prepared?: boolean;
  /** End of the appointment (the start is the activity's `scheduled_at`); > start, ≤ 24 h after it. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() end_at?: string | null;
}

// --- Activity drafts ---

export class ActivityDraftDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() account_id?: string | null;
  @IsOptional() @IsString() @MaxLength(255) account_name?: string | null;
  @IsIn(WINBACK_ACTIVITY_TYPES) type: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsIn(WINBACK_ACTIVITY_OUTCOMES) outcome?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsISO8601() activity_at?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() next_follow_up_at?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(WINBACK_NEXT_ACTIONS) follow_up_action?: string | null;
  /** Already-uploaded `/upload/activity-photo` URLs (a draft cannot hold local files). */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) photo_urls?: string[];
}

// --- Coaching tasks ---

export class CoachingTaskQueryDto {
  /** Manager: any rep (omit = whole team); sales user: forced to self. */
  @IsOptional() @IsUUID() sales_user_id?: string;
  @IsOptional() @IsUUID() account_id?: string;
  @IsOptional() @Transform(toOptionalBoolean) @IsBoolean() open_only?: boolean;
}

export class CreateCoachingTaskDto {
  @IsUUID() sales_user_id: string;
  @IsUUID() account_id: string;
  @IsString() @MinLength(1) @MaxLength(500) action: string;
  @IsISO8601() due_at: string;
  @IsString() @MinLength(1) @MaxLength(2000) manager_note: string;
}

export class UpdateCoachingTaskDto {
  /** Manager only. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) action?: string;
  @IsOptional() @IsISO8601() due_at?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) manager_note?: string;
  /** Manager or the task's rep: closing needs a non-empty result. `null` reopens. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MinLength(1) @MaxLength(2000) result?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() completed_at?: string | null;
}

// --- Teams ---

export class TeamDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsArray() @ArrayMaxSize(UUID_LIST_MAX) @ArrayUnique() @IsUUID('all', { each: true }) sales_user_ids: string[];
}

// --- Work plan / saved places / discovery query ---

export class WorkPlanDto {
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(WINBACK_WORK_PLAN_STEPS, { each: true }) completed?: string[];
  @IsOptional() @IsIn(WINBACK_NEXT_ACTIONS) next_action?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() due_at?: string | null;
  @IsOptional() @IsString() @MaxLength(500) blocker?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsBoolean() preparation_complete?: boolean;
}

export class WorkPlanQueryDto {
  /** Comma list of account ids (≤200) — for the control room / pool tiles in one call. */
  @Transform(toList) @IsArray() @ArrayMaxSize(UUID_LIST_MAX) @IsUUID('all', { each: true }) account_ids: string[];
}

export const DISCOVERY_RADII_KM = [1, 3, 5, 10, 20];

export class DiscoveryQueryDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) province_code?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsIn(DISCOVERY_RADII_KM) radius_km?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(-90) @Max(90) origin_lat?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber() @Min(-180) @Max(180) origin_lng?: number | null;
}

// --- Joint visits ---

export class JointVisitDto {
  @IsUUID() participant_id: string;
  @IsString() @MinLength(1) @MaxLength(1000) note: string;
}

// --- Sync history ---

export class SyncRunQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

// --- Commercial (record-only) ---

export class QuoteLineDto {
  @IsString() @MinLength(1) @MaxLength(64) product_id: string;
  @IsString() @MinLength(1) @MaxLength(64) unit_id: string;
  @Type(() => Number) @IsNumber() @Min(0.0001) @Max(100000) quantity: number;
}

export class QuoteTermsDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(365) credit_days: number;
  @IsString() @MaxLength(64) price_list_id: string;
  @IsString() @MaxLength(64) warehouse_id: string;
  @IsString() @MaxLength(64) delivery_slot_id: string;
  @IsString() @MinLength(1) @MaxLength(500) delivery_location: string;
}

export class SaveQuoteDto {
  @IsUUID() account_id: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines: QuoteLineDto[];
  /** `YYYY-MM-DD`, today or later (Bangkok). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'valid_until must be YYYY-MM-DD' }) valid_until: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => QuoteTermsDto) terms?: QuoteTermsDto | null;
  /** Required when revising (`PUT /quotes/:id`); ignored on create. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expected_version?: number;
}

export class QuoteQueryDto {
  @IsOptional() @IsUUID() sales_user_id?: string;
  @IsOptional() @IsUUID() account_id?: string;
}

export class MoveQuoteDto {
  @IsIn(WINBACK_QUOTE_STATUSES.filter((s) => s !== 'expired')) status: string;
  @Type(() => Number) @IsInt() @Min(1) expected_version: number;
}

export class QuoteFollowUpDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'at must be YYYY-MM-DD' }) at: string;
  @IsString() @MinLength(1) @MaxLength(2000) note: string;
  @Type(() => Number) @IsInt() @Min(1) expected_version: number;
}

export class QuoteDispatchDto {
  @IsIn(WINBACK_QUOTE_DISPATCH_CHANNELS) channel: string;
  @Type(() => Number) @IsInt() @Min(1) content_version: number;
  @Type(() => Number) @IsInt() @Min(1) expected_version: number;
}

export class TermOptionDto {
  @IsString() @MinLength(1) @MaxLength(64) id: string;
  @IsString() @MinLength(1) @MaxLength(200) label: string;
}

export class DeliverySlotDto extends TermOptionDto {
  @IsArray() @ArrayUnique() @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weekdays: number[];
  @Type(() => Number) @IsInt() @Min(0) @Max(1439) before_minutes: number;
}

export class QuoteTermsCatalogDto {
  @IsArray() @ArrayMaxSize(50) @Type(() => Number) @IsInt({ each: true }) @Min(0, { each: true }) @Max(365, { each: true }) credit_days: number[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TermOptionDto) price_lists: TermOptionDto[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TermOptionDto) warehouses: TermOptionDto[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => DeliverySlotDto) delivery_slots: DeliverySlotDto[];
}

export class DailyReportTotalsDto {
  @Type(() => Number) @IsNumber() @Min(0) gmv: number;
  @Type(() => Number) @IsInt() @Min(0) orders: number;
  @Type(() => Number) @IsInt() @Min(0) customers: number;
  @Type(() => Number) @IsInt() @Min(0) completed: number;
  @Type(() => Number) @IsInt() @Min(0) planned: number;
}

export class DailyReportQueryDto {
  @IsOptional() @IsUUID() sales_user_id?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' }) to?: string;
  @IsOptional() @IsIn(WINBACK_DAILY_REPORT_STATUSES) status?: string;
}

export class SaveDailyReportDto {
  @IsString() @MinLength(1) @MaxLength(4000) note: string;
  @IsString() @MinLength(1) @MaxLength(4000) next_plan: string;
  @IsOptional() @ValidateNested() @Type(() => DailyReportTotalsDto) totals?: DailyReportTotalsDto;
  @IsOptional() @IsArray() @ArrayMaxSize(UUID_LIST_MAX) @IsUUID('all', { each: true }) evidence_ids?: string[];
  @Type(() => Number) @IsInt() @Min(1) expected_version: number;
}

export class SubmitDailyReportDto {
  @Type(() => Number) @IsInt() @Min(1) expected_version: number;
}

export class ReviewDailyReportDto {
  @IsBoolean() approved: boolean;
  /** Required when sending back (`approved: false`). */
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @Type(() => Number) @IsInt() @Min(1) expected_version: number;
}

export class InvoiceEvidenceQueryDto {
  @IsOptional() @IsUUID() sales_user_id?: string;
  @IsOptional() @IsUUID() account_id?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 100;
}

