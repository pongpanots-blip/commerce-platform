import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class ScrapingFieldDto {
  @IsString() @Matches(/^[a-z][a-zA-Z0-9_]{0,39}$/) key: string;
  @IsString() @Length(1, 100) label: string;
  @IsString() @Length(1, 300) selector: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/) attribute?: string;
}
export class ScrapingConfigDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true }) @MaxLength(2000, { each: true }) startUrls: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(300, { each: true }) pathPrefixes: string[];
  @IsIn(['html', 'browser']) mode: 'html' | 'browser';
  @IsString() @MaxLength(300) itemSelector: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ScrapingFieldDto) fields: ScrapingFieldDto[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @Matches(/^[a-z][a-zA-Z0-9_]{0,39}$/, { each: true }) selectedFields?: string[];
  @IsOptional() @IsBoolean() autoCards?: boolean;
  @IsOptional() @IsIn(['none', 'browser']) pagination?: 'none' | 'browser';
  @IsString() @Matches(/^[A-Z]{3}$/) currency: string;
  @IsBoolean() vatIncluded: boolean;
  @IsString() @Length(1, 1000) priceContext: string;
  @IsBoolean() collectionAllowed: boolean;
  @IsInt() @Min(1) @Max(168) intervalHours: number;
  @IsInt() @Min(1) @Max(5000) maxPages: number;
  @IsInt() @Min(1000) @Max(10000) delayMs: number;
}
export class SaveScrapingSourceDto {
  @IsOptional() @IsInt() @Min(1) revision?: number;
  @IsString() @Length(1, 100) name: string;
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(500) origin: string;
  @IsDefined() @ValidateNested() @Type(() => ScrapingConfigDto) config: ScrapingConfigDto;
  @IsBoolean() enabled: boolean;
}
export class PreviewScrapingDto extends SaveScrapingSourceDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2000) sampleUrl: string;
}
export class StartScrapingDto {
  @IsInt() @Min(1) revision: number;
  @IsBoolean() restart: boolean;
}
export class DiscoverScrapingDto {
  @IsString() @Length(1, 2000) website: string;
  @IsBoolean() collectionAllowed: boolean;
}
