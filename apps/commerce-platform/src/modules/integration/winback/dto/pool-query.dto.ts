import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WINBACK_HEALTHS, WINBACK_LIFECYCLES, WINBACK_SOURCES, WINBACK_STAGES } from '../winback.enums';

function toOptionalBoolean({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export class PoolQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(WINBACK_HEALTHS) health?: string;
  @IsOptional() @IsIn(WINBACK_STAGES) stage?: string;
  @IsOptional() @IsIn(WINBACK_SOURCES) source?: string;
  @IsOptional() @IsIn(WINBACK_LIFECYCLES) lifecycle?: string;
  @IsOptional() @IsString() cuisine_id?: string;
  @IsOptional() @IsIn(['assigned', 'unassigned']) assigned?: string;
  /** Filter pool to leads owned by a specific sales user (manager team drill-down). */
  @IsOptional() @IsString() @MaxLength(36) assigned_sales_user_id?: string;
  /**
   * When true with assigned=unassigned: list Market Explorer restaurant_place rows
   * that have no winback TMP lead yet (ยังไม่มีคนดูแล) with full GMap restaurantPlace.
   */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  include_places?: boolean;
  @IsOptional()
  @IsIn([
    'last_order_at',
    'inactive_days',
    'display_name',
    'create_date',
    // Signal-first sorts, for working an unassigned pool of thousands.
    'delay_ratio',
    'avg_monthly_revenue',
  ])
  sortKey?: string;
  @IsOptional() @IsIn(['ASC', 'DESC']) sortOrder?: 'ASC' | 'DESC';
  /** Territory filter, matched exactly against `winback_account.province`. */
  @IsOptional() @IsString() @MaxLength(64) province?: string;
  /** Dashboard click-through: re-engage (30–59) / inactive (60+). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) inactive_min?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) inactive_max?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
