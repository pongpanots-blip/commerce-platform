import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

// All lead fields optional; `contacts` is ignored on update (managed via contact endpoints).
export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  /** Assign owner; pass `null` to unassign. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assigned_sales_user_id?: string | null;
}
