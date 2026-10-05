import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { WINBACK_REJECT_REASONS, WINBACK_STAGES } from '../winback.enums';

export class MoveStageDto {
  @IsIn(WINBACK_STAGES) stage: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsIn(WINBACK_REJECT_REASONS) reject_reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) reject_note?: string;
}
