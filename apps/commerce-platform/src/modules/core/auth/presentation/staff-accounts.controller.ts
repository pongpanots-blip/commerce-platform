import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { STAFF_ROLES, StaffRole, normalizeStaffRole } from '../../../../shared-kernel/presentation/auth.decorators';
import { StaffAccountsService, StaffStatus } from '../application/staff-accounts.service';
import { StaffPrincipal } from './staff-auth.guard';

class CreateStaffDto {
  @IsEmail() @MaxLength(191) email!: string;
  @IsOptional() @IsString() @MaxLength(191) name?: string | null;
  @Transform(({ value }) => typeof value === 'string' ? normalizeStaffRole(value) : value) @IsIn(STAFF_ROLES) role!: StaffRole;
}

class UpdateStaffDto {
  @IsOptional() @IsString() @MaxLength(191) name?: string | null;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? normalizeStaffRole(value) : value) @IsIn(STAFF_ROLES) role?: StaffRole;
  @IsOptional() @IsIn(['active', 'disabled']) status?: StaffStatus;
}

type StaffRequest = { staff: StaffPrincipal };
const actor = (req: StaffRequest) => ({ userId: req.staff.userId, email: req.staff.email });

/** commerce-admin › บัญชี staff. Admin only (the guard's default). */
@Controller('admin/staff')
export class StaffAccountsController {
  constructor(private readonly accounts: StaffAccountsService) {}

  @Get() list() { return this.accounts.list(); }

  @Post() @HttpCode(200)
  create(@Body() dto: CreateStaffDto, @Req() req: StaffRequest) { return this.accounts.create(dto, actor(req)); }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto, @Req() req: StaffRequest) {
    return this.accounts.update(id, dto, actor(req));
  }

  @Post(':id/reset-password') @HttpCode(200)
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) { return this.accounts.resetPassword(id, actor(req)); }
}
