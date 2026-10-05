import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class DiaryQueryDto {
  @IsOptional() @IsString() sales_user_id?: string;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
