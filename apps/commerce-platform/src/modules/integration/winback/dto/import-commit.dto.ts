import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class ImportCommitItemDto {
  @IsString() @MaxLength(50) customer_code: string;
  @IsOptional() @IsString() @MaxLength(255) display_name?: string | null;
  @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(100) register_number?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber() lifetime_spend_hint?: number | null;
  @IsOptional() @IsString() josh_user_id?: string | null;
  @IsOptional() @IsString() josh_company_id?: string | null;
}

export class ImportCommitDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ImportCommitItemDto)
  rows: ImportCommitItemDto[];
}
