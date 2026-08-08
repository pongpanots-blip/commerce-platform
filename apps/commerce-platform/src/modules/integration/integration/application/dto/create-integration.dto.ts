import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIntegrationDto {
  @IsString()
  @MaxLength(128)
  name: string;

  @IsString()
  @MaxLength(64)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slug?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  signingSecret?: string;
}
