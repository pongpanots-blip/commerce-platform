import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

function toOptionalBoolean({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

/** Shared list/export filters for Market Explorer. */
export class RestaurantPlaceFiltersDto {
  /** Case-insensitive substring on name_th or name_en. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  maxRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minReviewCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxReviewCount?: number;

  @IsOptional()
  @IsString()
  priceRange?: string;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isEnriched?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  dineIn?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  takeaway?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  delivery?: boolean;

  @IsOptional()
  @Matches(/^\d{1,2}-\d{1,2}$/, {
    message: 'busyWindow must look like "17-20"',
  })
  busyWindow?: string;

  /** Hide places that already have a linked winback account. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  excludeHasTmpLead?: boolean;
}
