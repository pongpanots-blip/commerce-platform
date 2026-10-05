import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class ScorecardQueryDto {
  @IsOptional() @IsIn(['team', 'me']) scope?: 'team' | 'me';
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
