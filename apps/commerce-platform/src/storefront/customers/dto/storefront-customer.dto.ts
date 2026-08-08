import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StorefrontCustomerDto {
  @ApiProperty({ example: 'Somchai Jaidee' })
  @IsString() @MinLength(1) @MaxLength(191) name: string;

  @ApiPropertyOptional({ example: 'somchai@example.com' })
  @IsOptional() @IsString() @MaxLength(191) email?: string;

  @ApiPropertyOptional({ example: '0812345678' })
  @IsOptional() @IsString() @MaxLength(32) phone?: string;

  @ApiPropertyOptional({ example: '1234567890123' })
  @IsOptional() @IsString() @MaxLength(32) taxId?: string;
}
