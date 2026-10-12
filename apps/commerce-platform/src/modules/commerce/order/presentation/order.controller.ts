import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
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
  @StaffRoles('business_analyst')
  override list(@Query() query: OrderListQueryDto) {
    return this.service.listForAdmin(query);
  }

  @Post()
  override create(@Body() dto: CreateOrderDto) {
    return this.service.createWithLines(dto);
  }

  @Get(':id')
  @StaffRoles('business_analyst')
  override get(@Param('id', ParseUUIDPipe) id: string) {
    return super.get(id);
  }

  @Get(':id/full')
  @StaffRoles('business_analyst')
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
