import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  RESEARCH_KINDS,
  RESEARCH_SOURCES,
  type ResearchKind,
  type ResearchSource,
} from '../research.types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

class ResearchTopicFieldsDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(400) title: string;
  @IsIn(RESEARCH_KINDS) kind: ResearchKind;
  @IsIn(['กรุงเทพมหานคร', 'กรุงเทพฯ และปริมณฑล', 'ทั่วประเทศไทย']) area =
    'กรุงเทพมหานคร';
  @IsInt() @IsIn([7, 14, 30]) days = 30;
  @IsIn([
    'ทุกกลุ่ม · น้ำหนักเท่ากัน',
    'ร้านอาหาร',
    'โรงแรม / จัดเลี้ยง',
    'ร้านค้าปลีก',
    'โรงงานอาหาร',
  ])
  sector = 'ทุกกลุ่ม · น้ำหนักเท่ากัน';
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsIn(RESEARCH_SOURCES, { each: true })
  sources: ResearchSource[] = ['tat', 'osm'];
  @IsBoolean() followHourly = false;
}

export class CreateResearchTopicDto extends ResearchTopicFieldsDto {
  @IsOptional()
  @IsUUID('4')
  requestId?: string;
}

export class UpdateResearchTopicDto extends ResearchTopicFieldsDto {
  @IsInt() @Min(1) version: number;
}
export class ResearchVersionDto {
  @IsInt() @Min(1) version: number;
}
export class ResearchRunRequestDto {
  @IsUUID('4') requestId: string;
}
export class ResearchListDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsIn(RESEARCH_KINDS) kind?: ResearchKind;
}
export class EvidenceDto {
  @IsString() @IsNotEmpty() @MaxLength(80) id: string;
  @IsIn(RESEARCH_SOURCES) source: ResearchSource;
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2000)
  url: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) excerpt: string;
  @IsOptional() @IsDateString() publishedAt?: string;
  @IsDateString() collectedAt: string;
}
export class FindingDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) text: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  evidenceIds: string[];
}
export class CoverageDto {
  @IsIn(RESEARCH_SOURCES) source: ResearchSource;
  @IsIn(['searched', 'unavailable']) status: 'searched' | 'unavailable';
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
export class ResearchAiContentDto {
  @IsString() @MaxLength(3000) summary: string;
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => FindingDto)
  findings: FindingDto[];
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => FindingDto)
  suggestions: FindingDto[];
}
export class ResearchAnalysisDto extends ResearchAiContentDto {
  @IsIn(['completed', 'not_configured', 'unavailable', 'insufficient_data'])
  status: 'completed' | 'not_configured' | 'unavailable' | 'insufficient_data';
  @IsIn(['gemini']) provider: 'gemini';
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsString() @MaxLength(30) keyAlias?: string;
  @IsOptional() @IsDateString() generatedAt?: string;
  @IsInt() @Min(0) @Max(50) sampleSize: number;
  @IsString() @MaxLength(1000) reason: string;
}
export class CompleteResearchRunDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ResearchAnalysisDto)
  analysis?: ResearchAnalysisDto;
  @IsUUID('4') leaseToken: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) summary: string;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  evidence: EvidenceDto[];
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FindingDto)
  findings: FindingDto[];
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  suggestions: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  limitations: string[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => CoverageDto)
  coverage: CoverageDto[];
}
export class ResearchLeaseDto {
  @IsUUID('4') leaseToken: string;
}
export class FailResearchRunDto extends ResearchLeaseDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) message: string;
}
