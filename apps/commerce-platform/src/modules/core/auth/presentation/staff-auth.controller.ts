import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { PortalAuthService } from '../application/portal-auth.service';
import { Public, STAFF_ROLES, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { StaffPrincipal } from './staff-auth.guard';

class StaffLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}

/** Sign-in for commerce-admin. Staff accounts are created with the create-staff CLI, never self-registered. */
@Controller('admin/auth')
export class StaffAuthController {
  constructor(private readonly auth: PortalAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: StaffLoginDto) {
    const session = await this.auth.login(dto.email, dto.password);
    if (!STAFF_ROLES.includes(session.role as never)) {
      throw new ForbiddenException('not a commerce-admin account');
    }
    return session;
  }

  @StaffRoles('marketing')
  @Get('me')
  me(@Req() req: { staff: StaffPrincipal }) {
    return req.staff;
  }
}
