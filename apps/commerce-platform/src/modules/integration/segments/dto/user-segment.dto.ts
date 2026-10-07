import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { USER_SEGMENT_RULE_TYPE_VALUES } from '../rule-type.enum';
import { SegmentDefinition } from './segment-definition.dto';

export class CreateUserSegmentDto {
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase kebab-case',
  })
  slug: string;

  @IsString()
  @MaxLength(155)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(USER_SEGMENT_RULE_TYPE_VALUES)
  rule_type: (typeof USER_SEGMENT_RULE_TYPE_VALUES)[number];

  @IsOptional()
  @IsObject()
  rule_config?: Record<string, unknown>;

  /**
   * Optional condition-tree definition (Task 6). Shape-checked here only;
   * `UserSegmentService` runs `SegmentDefinitionCompiler.validate` before
   * persisting, which throws a field-aware `BadRequestException` on an
   * unknown field/operator/value shape.
   */
  @IsOptional()
  @IsObject()
  definition?: SegmentDefinition;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateUserSegmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(155)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(USER_SEGMENT_RULE_TYPE_VALUES)
  rule_type?: (typeof USER_SEGMENT_RULE_TYPE_VALUES)[number];

  @IsOptional()
  @IsObject()
  rule_config?: Record<string, unknown>;

  /** See `CreateUserSegmentDto.definition`. */
  @IsOptional()
  @IsObject()
  definition?: SegmentDefinition;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
