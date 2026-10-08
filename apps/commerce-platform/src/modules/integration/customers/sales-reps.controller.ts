import { Body, Controller, Patch } from '@nestjs/common';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { SalesRepsService } from './sales-reps.service';

class AssignSalesDto {
  @IsUUID() company_id!: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsUUID() sales_user_id?: string | null;
}

/** josh CS-admin's PATCH /cs-admin/sales-assignment, here. Admin and the commerce sales_manager role (josh's person stays `manager`). */
@Controller('cs-admin')
@StaffRoles('sales_manager')
export class SalesRepsController {
  constructor(private readonly reps: SalesRepsService) {}

  @Patch('sales-assignment')
  assign(@Body() dto: AssignSalesDto) { return this.reps.assign(dto.company_id, dto.sales_user_id ?? null); }
}
