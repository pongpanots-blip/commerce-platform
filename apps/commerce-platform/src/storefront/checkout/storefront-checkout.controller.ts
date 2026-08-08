import { Body, Controller, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { StorefrontApiKeyGuard } from '../storefront-api-key.guard';
import { StorefrontCheckoutService } from './storefront-checkout.service';
import { PaymentResultDto, StorefrontCheckoutDto } from './dto/storefront-checkout.dto';

@ApiTags('storefront-checkout')
@ApiSecurity('apiKey')
@Controller('v1/storefront/checkout')
@UseGuards(StorefrontApiKeyGuard)
export class StorefrontCheckoutController {
  constructor(private readonly service: StorefrontCheckoutService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated key; replaying the same key returns the current state.' })
  checkout(@Body() dto: StorefrontCheckoutDto, @Headers('idempotency-key') key: string) {
    return this.service.checkout(dto, key); // service rejects missing key before any order is created
  }

  @Post(':orderId/payment-result')
  paymentResult(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: PaymentResultDto) {
    return this.service.paymentResult(orderId, dto.result);
  }
}
