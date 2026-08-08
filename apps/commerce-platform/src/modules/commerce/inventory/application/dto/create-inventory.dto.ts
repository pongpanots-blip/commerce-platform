import { IsNumberString, IsOptional, IsUUID } from 'class-validator';

export class CreateInventoryDto {
  @IsUUID()
  productId: string;

  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsNumberString()
  reserved?: string;
}
