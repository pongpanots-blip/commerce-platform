import { IsBoolean, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';

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
