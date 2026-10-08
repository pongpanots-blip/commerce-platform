import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WINBACK_ACTIVITY_OUTCOMES, WINBACK_ACTIVITY_TYPES, WINBACK_STAGES } from '../winback.enums';

export class CreateActivityDto {
  @IsIn(WINBACK_ACTIVITY_TYPES) type: string;
  @IsOptional() @IsIn(WINBACK_ACTIVITY_OUTCOMES) outcome?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsISO8601() activity_at?: string;
  @IsOptional() @IsISO8601() next_follow_up_at?: string;
  @IsOptional() @IsIn(WINBACK_STAGES) stage_after?: string;
  @IsOptional() @IsIn(['planned', 'done']) status?: string;
  @IsOptional() @IsISO8601() scheduled_at?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) photo_urls?: string[];
  @IsOptional() @IsISO8601() checkin_at?: string;
  @IsOptional() @IsISO8601() checkout_at?: string;
  @IsOptional() @Type(() => Number) @IsNumber() lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() lng?: number;
  @IsOptional() @IsString() contact_id?: string;
}

export class CheckinDto {
  @IsIn(WINBACK_ACTIVITY_TYPES) type: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
  /** GPS accuracy of lat/lng in metres, as the device reports it. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100000) accuracy_m?: number;
  @IsOptional() @IsString() contact_id?: string;
  /** When set, check into this planned appointment instead of creating a new activity. */
  @IsOptional() @IsString() planned_activity_id?: string;
}

export class CheckoutDto {
  @IsIn(WINBACK_ACTIVITY_OUTCOMES) outcome: string;
  @IsArray() @ArrayMinSize(1) @IsIn(WINBACK_ACTIVITY_TYPES, { each: true }) types: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) photo_urls?: string[];
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  /** Stage to move the lead to with this checkout (recorded on the visit + stage history, like `/complete`). */
  @IsOptional() @IsIn(WINBACK_STAGES) stage_after?: string;
  /** Where the rep is at check-out (optional; older app builds do not send it). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100000) accuracy_m?: number;
}

export class CompleteActivityDto {
  @IsOptional() @IsISO8601() activity_at?: string;
  @IsOptional() @IsIn(WINBACK_ACTIVITY_OUTCOMES) outcome?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsIn(WINBACK_STAGES) stage_after?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) photo_urls?: string[];
}

export class RescheduleActivityDto {
  @IsISO8601() scheduled_at: string;
}

export class CancelActivityDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
