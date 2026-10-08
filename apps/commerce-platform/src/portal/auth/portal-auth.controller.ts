import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalAuthService } from '../../modules/core/auth/application/portal-auth.service';
import { PortalLoginDto, PortalRegisterDto } from './dto/portal-auth.dto';
import { Public } from '../../shared-kernel/presentation/auth.decorators';
import { clientMeta, RefreshTokenDto } from '../../modules/core/auth/presentation/refresh-token.dto';

@ApiTags('portal-auth')
// Own auth (or health) — skip the global staff guard.
@Public()
@Controller('v1/portal/auth')
export class PortalAuthController {
  constructor(private readonly auth: PortalAuthService) {}

  @Post('register')
  register(@Body() dto: PortalRegisterDto) {
    return this.auth.register(dto.email, dto.password);
  }

  @Post('login')
  login(@Body() dto: PortalLoginDto, @Req() req: Parameters<typeof clientMeta>[0]) {
    return this.auth.login(dto.email, dto.password, 'portal', clientMeta(req));
  }

  /** Portal refresh tokens only; the old token is spent. */
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Parameters<typeof clientMeta>[0]) {
    return this.auth.refresh(dto.refreshToken, 'portal', clientMeta(req));
  }

  /** Always `{ ok: true }`, also for an unknown token. */
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken, 'portal');
  }
}
