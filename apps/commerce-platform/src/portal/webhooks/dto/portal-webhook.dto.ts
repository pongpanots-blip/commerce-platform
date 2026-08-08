import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateWebhookDto {
  @ApiProperty({ example: 'Order sync' })
  @IsString() @MaxLength(128) name: string;

  @ApiProperty({ example: 'https://example.com/webhooks/josh' })
  @IsUrl({ require_tld: false }) targetUrl: string;

  @ApiProperty({ example: ['order.created', 'order.confirmed'], type: [String] })
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) eventTypes: string[];

  @ApiPropertyOptional({ example: 'whsec_abc123' })
  @IsOptional() @IsString() @MaxLength(255) secret?: string;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({ example: 'https://example.com/webhooks/josh-v2' })
  @IsOptional() @IsUrl({ require_tld: false }) targetUrl?: string;

  @ApiPropertyOptional({ example: ['order.created', 'inventory.updated'], type: [String] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsString({ each: true }) eventTypes?: string[];

  @ApiPropertyOptional({ example: 'whsec_abc123' })
  @IsOptional() @IsString() @MaxLength(255) secret?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean() active?: boolean;
}
