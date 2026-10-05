import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ApiLogQueryDto {
  @IsOptional() @IsIn(['all', '2xx', '4xx', '5xx']) status?:
    | 'all'
    | '2xx'
    | '4xx'
    | '5xx';

  @IsOptional()
  @IsIn(['all', 'internal', 'jagota', 'kbank', 'erp_webhook'])
  source?: 'all' | 'internal' | 'jagota' | 'kbank' | 'erp_webhook';

  @IsOptional()
  @IsIn(['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  method?: 'all' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  @IsOptional() @IsISO8601() from?: string;

  @IsOptional() @IsISO8601() to?: string;

  /** ค้นใน message / URL */
  @IsOptional() @IsString() q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;

  /** Minimum duration in milliseconds */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minDurationMs?: number;

  /** Filter by requestId (overrides time window) */
  @IsOptional() @IsString() requestId?: string;

  /** Filter by userId */
  @IsOptional() @IsString() userId?: string;

  /** Sort order: 'newest' (default) or 'slowest' */
  @IsOptional() @IsIn(['newest', 'slowest']) sort?: 'newest' | 'slowest';
}
