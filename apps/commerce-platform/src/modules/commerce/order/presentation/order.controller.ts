import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { Order } from '../infrastructure/order.entity';
import { OrderService } from '../application/order.service';
import { OrderCheckoutSaga } from '../application/order-checkout.saga';
import { CreateOrderDto } from '../application/dto/create-order.dto';

@Controller('orders')
export class OrderController extends BaseCrudController<Order>() {
  constructor(
    protected readonly service: OrderService,
    private readonly saga: OrderCheckoutSaga,
  ) {
    super();
  }

  @Post()
  override create(@Body() dto: CreateOrderDto) {
    return this.service.createWithLines(dto);
  }

  @Get(':id/full')
  full(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getFull(id);
  }

  @Post(':id/checkout')
  checkout(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.saga.checkout(id, idempotencyKey);
  }
}
