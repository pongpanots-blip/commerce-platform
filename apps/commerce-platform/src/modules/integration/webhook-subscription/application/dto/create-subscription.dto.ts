import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  @MaxLength(128)
  name: string;

  @IsUrl({ require_tld: false })
  @MaxLength(1024)
  targetUrl: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  eventTypes: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
