import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PaymentService } from '../application/payment.service';

@Controller('payments')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @Get()
  list(@Query('orderId') orderId?: string) {
    return this.service.list(orderId);
  }

  @Post(':id/pay')
  pay(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.markPaid(id);
  }

  @Post(':id/fail')
  fail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.markFailed(id);
  }
}
