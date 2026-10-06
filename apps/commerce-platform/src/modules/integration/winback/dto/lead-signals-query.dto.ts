import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class LeadSignalsQueryDto {
  /** Narrow to one rep. Omit for the caller's whole scope. */
  @IsOptional() @IsUUID() sales_user_id?: string;

  /**
   * Cap on returned leads. Ordering is oldest `last_activity_at` first (leads
   * never touched at all come first), so a cap drops the freshest leads — the
   * ones least likely to be raised at the meeting.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2000) limit?: number;
}
