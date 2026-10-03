import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalAuthService } from '../../modules/core/auth/application/portal-auth.service';
import { PortalLoginDto, PortalRegisterDto } from './dto/portal-auth.dto';
import { Public } from '../../shared-kernel/presentation/auth.decorators';

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
  login(@Body() dto: PortalLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }
}
