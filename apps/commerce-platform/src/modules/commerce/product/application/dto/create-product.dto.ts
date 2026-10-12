import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const NOT_BLANK = /\S/;

export class CreateProductDto {
  @IsString()
  @Matches(NOT_BLANK, { message: 'sku must not be blank' })
  @MaxLength(64)
  sku: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'name must not be blank' })
  @MaxLength(191)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  status?: string;
}
