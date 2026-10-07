import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** josh's DTOs (product-category / brand), so the hosted josh pages send the same bodies here. */
export class CategorySortOptionDto {
  @IsString() key!: string;
  @IsString() label!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) order?: number;
}

export class CreateCategoryDto {
  @IsString() @MaxLength(100) category_name_en!: string;
  @IsOptional() @IsUUID() parent_id?: string;
  @IsOptional() @IsString() @MaxLength(100) category_name_th?: string;
  @IsOptional() @IsString() category_image?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(9) category_level?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
  @IsOptional() @Type(() => Boolean) @IsBoolean() is_active?: boolean;
  @IsOptional() @Type(() => Boolean) @IsBoolean() show_on_homepage?: boolean;
  @IsOptional() @IsString() @MaxLength(100) default_sort_key?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CategorySortOptionDto) sort_options?: CategorySortOptionDto[];
}

export class UpdateCategoryDto extends PartialType(OmitType(CreateCategoryDto, ['parent_id', 'category_level'] as const)) {}

export class OrderedIdsDto {
  @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) orderedIds!: string[];
}

export class UpdateBrandDto {
  @IsOptional() @IsString() @MaxLength(255) brand_name_th?: string;
  @IsOptional() @IsString() @MaxLength(255) brand_name_en?: string;
}
