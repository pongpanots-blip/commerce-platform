import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';

export class StorefrontCheckoutLineDto {
  @ApiProperty({ example: 'b3f1c2a4-1234-4a5b-8c9d-abcdef012345' })
  @IsUUID() productId: string;

  @ApiProperty({ example: 1 })
  @IsNumber() @IsPositive() qty: number;

  @ApiProperty({ example: 150 })
  @IsNumber() @Min(0) unitPrice: number;
}

export class StorefrontCheckoutDto {
  @ApiProperty({ example: 'a1b2c3d4-5678-4abc-9def-0123456789ab' })
  @IsUUID() customerId: string;

  @ApiPropertyOptional({ example: 'THB' })
  @IsOptional() @IsString() currency?: string;

  @ApiProperty({ type: [StorefrontCheckoutLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => StorefrontCheckoutLineDto)
  lines: StorefrontCheckoutLineDto[];
}

export class PaymentResultDto {
  @ApiProperty({ enum: ['paid', 'failed'], example: 'paid' })
  @IsIn(['paid', 'failed']) result: 'paid' | 'failed';
}
