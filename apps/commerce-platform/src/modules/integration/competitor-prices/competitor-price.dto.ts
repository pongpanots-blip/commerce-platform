// Same DTOs as josh apps/backend/src/app/competitor-prices/dto/competitor-price.dto.ts (origin/main 8a44dd00).
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsISO8601, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class SaveCompetitorPriceDto {
  @IsOptional() @IsUUID() catalogItemId?: string;
  @IsOptional() @IsInt() @Min(1) revision?: number;
  @IsString() @Length(1, 100) sku: string;
  /** Weight of ONE ERP selling unit (KG-rate SKUs may use a desired comparison quantity). */
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(100000) ourWeightKg: number;
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2000) sourceUrl: string;
  @IsString() @Length(1, 500) competitorName: string;
  @IsOptional() @IsString() @MaxLength(100) competitorSku?: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(100000) competitorWeightKg: number;
  @IsString() @Length(1, 1000) sourceContext: string;
  @IsBoolean() vatIncluded: boolean;
  @IsBoolean() collectionAllowed: boolean;
  @IsBoolean() autoRefresh: boolean;
}

export class CompetitorOverviewQueryDto {
  @IsOptional() @IsString() @MaxLength(200) site?: string;
  @IsOptional() @IsString() @MaxLength(200) category?: string;
  @IsOptional() @IsIn(['we_cheaper', 'we_pricier', 'same', 'no_data', 'unmatched', 'matched']) position?: 'we_cheaper' | 'we_pricier' | 'same' | 'no_data' | 'unmatched' | 'matched';
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}
export class ConfirmCompetitorPriceDto {
  @IsInt() @Min(1) revision: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) ourProductVersion: string;
}
export class MatchCatalogItemDto {
  @IsUUID() catalogItemId: string;
  @IsString() @Length(1, 100) sku: string;
}
export class VerifyCompetitorPriceDto {
  @IsInt() @Min(1) revision: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) ourProductVersion: string;
  @IsString() @Length(10, 1000) matchNote: string;
}

export class CaptureCompetitorPriceDto {
  @IsInt() @Min(1) revision: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99) priceIncVat: number;
  @IsISO8601({ strict: true }) observedAt: string;
}

export class ReviewGridQueryDto {
  @IsOptional() @IsString() @MaxLength(200) category?: string;
  @IsOptional() @IsIn(['todo', 'done']) show?: 'todo' | 'done';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}
export class TypedSizeDto {
  @IsIn(['kg', 'g', 'l', 'ml', 'piece']) unit: 'kg' | 'g' | 'l' | 'ml' | 'piece';
  @IsNumber() @Min(0.0001) @Max(100000) min: number;
  @IsOptional() @IsNumber() @Min(0.0001) @Max(100000) max?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) packCount?: number;
}
export class ReviewCellDto {
  @IsString() @Length(1, 100) sku: string;
  @IsBoolean() on: boolean;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsUUID() pairId?: string;
  @IsOptional() @ValidateNested() @Type(() => TypedSizeDto) size?: TypedSizeDto;
}
export class ReviewAcceptDto {
  @IsString() @Length(1, 100) sku: string;
  @IsUUID() itemId: string;
}
export class ReviewFinishDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 100, { each: true }) skus: string[];
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ReviewAcceptDto) accept: ReviewAcceptDto[];
}
export class ReviewSearchQueryDto {
  @IsString() @Length(1, 100) site: string;
  @IsString() @Length(1, 200) q: string;
  @IsString() @Length(1, 100) sku: string;
}
