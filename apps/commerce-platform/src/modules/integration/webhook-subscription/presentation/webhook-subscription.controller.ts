import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DeliveryStatus } from '../infrastructure/webhook-delivery.entity';
import { WebhookSubscriptionService } from '../application/webhook-subscription.service';
import { CreateSubscriptionDto } from '../application/dto/create-subscription.dto';
import { UpdateSubscriptionDto } from '../application/dto/update-subscription.dto';

@Controller('webhook-subscriptions')
export class WebhookSubscriptionController {
  constructor(private readonly service: WebhookSubscriptionService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('deliveries')
  deliveries(@Query('status') status?: DeliveryStatus) {
    return this.service.listDeliveries(100, status);
  }

  @Post('deliveries/:id/retry')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.retryDelivery(id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSubscriptionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
