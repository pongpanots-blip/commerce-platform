import { Controller, Get, Post, Param, ParseUUIDPipe, Query, UseGuards, BadRequestException, Body, ValidationPipe } from '@nestjs/common';
import { Public } from '../../../shared-kernel/presentation/auth.decorators';
import { InternalKeyGuard } from './internal-key.guard';
import { ScrapingService } from '../application/scraping.service';

export class ReadProductDto {
  sourceId: string;
  url: string;
}

/**
 * Internal API for josh to call: machine-to-machine, requires X-Internal-Key header.
 * All endpoints return scraped data shapes matching what josh's competitor-prices.service expects.
 */
@Controller('internal/scraping')
@Public()
@UseGuards(InternalKeyGuard)
export class ScrapingInternalController {
  constructor(private readonly service: ScrapingService) {}

  /**
   * GET /api/internal/scraping/sources/by-origin?url=https://example.com
   * Returns the scraping source configured for this origin, or 404.
   */
  @Get('sources/by-origin')
  async findOrigin(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url parameter required');
    return this.service.findOrigin(url);
  }

  /**
   * GET /api/internal/scraping/items/:id
   * Returns a single scraped item by id, with current source and config version check.
   */
  @Get('items/:id')
  async item(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.item(id);
  }

  /**
   * POST /api/internal/scraping/read-product
   * Reads a single product from a source, extracting fields according to config.
   * josh calls this when it needs fresh data for a competitor-prices refresh.
   * Body: { sourceId: uuid, url: string }
   * Returns: ExtractedWebItem with weightKg parsed and observedAt set.
   */
  @Post('read-product')
  async readProduct(@Body(new ValidationPipe({ whitelist: true, transform: true })) dto: ReadProductDto) {
    if (!dto.sourceId || !dto.url) throw new BadRequestException('sourceId and url required');
    const source = await this.service.source(dto.sourceId);
    return this.service.readProduct(source, dto.url);
  }
}
