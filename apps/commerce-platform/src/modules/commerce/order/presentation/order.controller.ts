import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { Order } from '../infrastructure/order.entity';
import { OrderService } from '../application/order.service';
import { OrderCheckoutSaga } from '../application/order-checkout.saga';
import { CreateOrderDto } from '../application/dto/create-order.dto';
import { OrderListQueryDto } from './order-list.query';

@Controller('orders')
export class OrderController extends BaseCrudController<Order>() {
  constructor(
    protected readonly service: OrderService,
    private readonly saga: OrderCheckoutSaga,
  ) {
    super();
  }

  @Get()
  override list(@Query() query: OrderListQueryDto) {
    return this.service.findMany({
      page: query.page,
      pageSize: query.pageSize,
      where: query.customerId ? { customerId: query.customerId } : undefined,
    });
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
