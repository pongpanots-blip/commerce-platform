import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PortalJwtGuard } from '../portal-jwt.guard';
import { PortalWebhooksService } from './portal-webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/portal-webhook.dto';
import { EVENT_CATALOG } from './event-catalog';
import { Public } from '../../shared-kernel/presentation/auth.decorators';

@ApiTags('portal-webhooks')
@ApiBearerAuth()
// Own auth (or health) — skip the global staff guard.
@Public()
@Controller('v1/portal')
@UseGuards(PortalJwtGuard)
export class PortalWebhooksController {
  constructor(private readonly service: PortalWebhooksService) {}

  @Get('events')
  events() {
    return { items: EVENT_CATALOG };
  }

  @Get('deliveries')
  deliveries(@Req() req: { portalAccount: { accountId: string } }) {
    return this.service.recentDeliveriesForAccount(req.portalAccount.accountId);
  }

  @Get('webhooks')
  list(@Req() req: { portalAccount: { accountId: string } }) {
    return this.service.listForAccount(req.portalAccount.accountId);
  }

  @Post('webhooks')
  create(@Req() req: { portalAccount: { accountId: string } }, @Body() dto: CreateWebhookDto) {
    return this.service.createForAccount(req.portalAccount.accountId, dto);
  }

  @Patch('webhooks/:id')
  update(
    @Req() req: { portalAccount: { accountId: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.service.updateForAccount(id, req.portalAccount.accountId, dto);
  }

  @Post('webhooks/:id/test')
  test(@Req() req: { portalAccount: { accountId: string } }, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.sendTest(id, req.portalAccount.accountId);
  }
}
