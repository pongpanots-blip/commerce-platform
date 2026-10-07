import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';
import { JOSH_STAFF_ROLES, JoshStaffAccessService } from './josh-staff-access.service';

class JoshStaffChangeDto {
  @IsOptional() @IsIn(JOSH_STAFF_ROLES) role?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() revokeSessions?: boolean;
}

/** commerce-admin › ตั้งค่า › บัญชี josh (stage 6). Admin only (the guard's default). */
@Controller('admin/josh-staff')
export class JoshStaffAccessController {
  constructor(private readonly staff: JoshStaffAccessService) {}

  @Get() list() { return this.staff.list(); }

  @Patch(':id')
  set(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JoshStaffChangeDto, @Req() req: StaffRequest) {
    return this.staff.set(id, dto, { userId: req.staff.userId, email: req.staff.email });
  }
}
