import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';

export class CreateOrderLineDto {
  @IsUUID() productId: string;
  @IsNumber() @IsPositive() qty: number;
  @IsNumber() @Min(0) unitPrice: number;
}

export class CreateOrderDto {
  @IsUUID() customerId: string;
  @IsOptional() @IsString() currency?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines: CreateOrderLineDto[];
}
