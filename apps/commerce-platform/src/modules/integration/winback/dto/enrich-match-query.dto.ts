import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { JOSH_MATCH_STATUSES, JoshMatchStatus } from '../josh-match.helpers';

export class EnrichMatchQueryDto {
  @IsOptional() @IsIn(JOSH_MATCH_STATUSES) status?: JoshMatchStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
