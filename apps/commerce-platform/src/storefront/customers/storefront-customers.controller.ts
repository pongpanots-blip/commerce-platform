import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { StorefrontApiKeyGuard } from '../storefront-api-key.guard';
import { TrustedStorefrontKey } from '../trusted-storefront-key';
import { StorefrontCustomersService } from './storefront-customers.service';
import { StorefrontCustomerDto } from './dto/storefront-customer.dto';
import { Public } from '../../shared-kernel/presentation/auth.decorators';

@ApiTags('storefront-customers')
@ApiSecurity('apiKey')
// Own auth (or health) — skip the global staff guard.
@Public()
@Controller('v1/storefront/customers')
@UseGuards(StorefrontApiKeyGuard)
@TrustedStorefrontKey()
export class StorefrontCustomersController {
  constructor(private readonly service: StorefrontCustomersService) {}

  @Post()
  upsert(@Body() dto: StorefrontCustomerDto) {
    return this.service.upsert(dto);
  }
}
