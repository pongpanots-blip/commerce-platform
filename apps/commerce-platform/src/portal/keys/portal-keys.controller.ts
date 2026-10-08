import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PortalJwtGuard } from '../portal-jwt.guard';
import { ApiKeyService } from '../../modules/core/api-key/application/api-key.service';
import { Public } from '../../shared-kernel/presentation/auth.decorators';
import { KEY_MINT_NOT_APPROVED_MESSAGE, keyMintApproved } from './key-mint-approval';

class CreateKeyDto {
  @ApiProperty({ example: 'Production key' })
  @IsString() @MinLength(1) @MaxLength(128) name: string;
}

@ApiTags('portal-keys')
@ApiBearerAuth()
// Own auth (or health) — skip the global staff guard.
@Public()
@Controller('v1/portal/keys')
@UseGuards(PortalJwtGuard)
export class PortalKeysController {
  constructor(private readonly keys: ApiKeyService) {}

  @Get()
  list(@Req() req: { portalAccount: { accountId: string } }) {
    return this.keys.listForAccount(req.portalAccount.accountId);
  }

  @Post()
  create(@Req() req: { portalAccount: { accountId: string } }, @Body() dto: CreateKeyDto) {
    // Admin approval (PORTAL_KEY_MINT_ACCOUNT_IDS) before a developer can mint; existing keys are untouched.
    if (!keyMintApproved(req.portalAccount.accountId)) throw new ForbiddenException(KEY_MINT_NOT_APPROVED_MESSAGE);
    return this.keys.createKey(req.portalAccount.accountId, dto.name); // fullKey returned ONCE
  }

  @Post(':id/revoke')
  revoke(@Req() req: { portalAccount: { accountId: string } }, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(id, req.portalAccount.accountId);
  }
}
