import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { StorefrontApiKeyGuard } from '../storefront-api-key.guard';
import { StorefrontCatalogService } from './storefront-catalog.service';

@ApiTags('storefront-catalog')
@ApiSecurity('apiKey')
@Controller('v1/storefront/catalog')
@UseGuards(StorefrontApiKeyGuard)
export class StorefrontCatalogController {
  constructor(private readonly catalog: StorefrontCatalogService) {}

  @Get('products')
  list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('search') search?: string,
  ) {
    return this.catalog.list({
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
      search,
    });
  }

  @Get('products/:id')
  byId(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.byId(id);
  }
}
