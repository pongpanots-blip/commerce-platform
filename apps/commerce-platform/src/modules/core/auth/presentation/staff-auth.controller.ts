import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '../../../integration/winback/shared/throttle';
import { PortalAuthService } from '../application/portal-auth.service';
import { MIN_PASSWORD, StaffAccountsService } from '../application/staff-accounts.service';
import { AllowPendingPassword, AllowReadOnlyWrite, AnyStaff, Public } from '../../../../shared-kernel/presentation/auth.decorators';
import { StaffPrincipal } from './staff-auth.guard';
import { clientMeta, RefreshTokenDto } from './refresh-token.dto';

class StaffLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}

class StaffRegisterDto {
  @IsEmail() @MaxLength(191) email!: string;
  @IsString() @MinLength(MIN_PASSWORD) @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(191) name?: string | null;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) currentPassword!: string;
  @IsString() @MinLength(MIN_PASSWORD) @MaxLength(200) newPassword!: string;
}

/** Sign-in for commerce-admin. Accounts come from the create-staff CLI, an admin, or self-registration (disabled until an admin opens it). */
@Controller('admin/auth')
export class StaffAuthController {
  constructor(private readonly auth: PortalAuthService, private readonly accounts: StaffAccountsService) {}

  /** `{ accessToken, role, mustChangePassword, refreshToken, expiresIn, refreshExpiresIn }` — a non-staff account is 403. */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: StaffLoginDto, @Req() req: Parameters<typeof clientMeta>[0]) {
    return this.auth.login(dto.email, dto.password, 'staff', clientMeta(req));
  }

  /** @jagota.co.th only; `{ email, status: 'disabled' }` — signing in works once an admin opens the account. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('register')
  @HttpCode(200)
  register(@Body() dto: StaffRegisterDto) {
    return this.accounts.register(dto.email, dto.password, dto.name);
  }

  /** Trade a staff refresh token for a new pair (the old one is spent). No access token needed — it may have expired. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Parameters<typeof clientMeta>[0]) {
    return this.auth.refresh(dto.refreshToken, 'staff', clientMeta(req));
  }

  /** Ends this sign-in (the refresh token's family). Always `{ ok: true }`. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken, 'staff');
  }

  @AnyStaff()
  @AllowPendingPassword()
  @Get('me')
  me(@Req() req: { staff: StaffPrincipal }) {
    return req.staff;
  }

  /** Any staff member changes their own password (the current one is checked). */
  @AnyStaff()
  @AllowPendingPassword()
  @AllowReadOnlyWrite()
  @Post('password')
  @HttpCode(200)
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: { staff: StaffPrincipal }) {
    return this.accounts.changeOwnPassword({ userId: req.staff.userId, email: req.staff.email }, dto.currentPassword, dto.newPassword);
  }
}
