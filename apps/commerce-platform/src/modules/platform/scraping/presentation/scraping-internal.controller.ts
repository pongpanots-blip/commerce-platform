import { Controller, Get, Post, Param, ParseUUIDPipe, Query, UseGuards, BadRequestException, Body, ValidationPipe } from '@nestjs/common';
import { IsUUID, IsUrl, MaxLength } from 'class-validator';
import { Public } from '../../../../shared-kernel/presentation/auth.decorators';
import { InternalKeyGuard } from './internal-key.guard';
import { ScrapingService } from '../application/scraping.service';

export class ReadProductDto {
  @IsUUID('4') sourceId: string;
  @IsUrl({ require_protocol: true }) @MaxLength(2000) url: string;
}

/**
 * Internal API for josh to call: machine-to-machine, requires X-Internal-Key header.
 * All endpoints return scraped data shapes matching what josh's competitor-prices.service expects.
 * Marked @Public() to skip the global staff auth guard; InternalKeyGuard provides API key auth.
 */
@Controller('internal/scraping')
@Public()
@UseGuards(InternalKeyGuard)
export class ScrapingInternalController {
  constructor(private readonly service: ScrapingService) {}

  /**
   * GET /api/internal/scraping/sources?ids=uuid,uuid,…
   * Returns scraping sources by ids (max 200). Unknown ids omitted.
   * Fields: id, name, origin, config, revision.
   */
  @Get('sources')
  async getSources(@Query('ids') ids?: string) {
    if (!ids) throw new BadRequestException('ids query parameter required (comma-separated UUIDs)');
    const idList = ids.split(',').slice(0, 200);
    // Validate each id is a UUID format
    for (const id of idList) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) {
        throw new BadRequestException('invalid UUID format');
      }
    }
    const sources = await Promise.all(idList.map(id => this.service.source(id.trim()).catch(() => null)));
    return sources.filter(Boolean).map(s => ({ id: s.id, name: s.name, origin: s.origin, config: s.config, revision: s.revision }));
  }

  /**
   * GET /api/internal/scraping/sources/by-origin?url=https://example.com
   * Returns the scraping source configured for this origin, or 404.
   */
  @Get('sources/by-origin')
  async findOrigin(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url parameter required');
    const source = await this.service.findOrigin(url);
    if (!source) return source;
    // The site password (even encrypted) and the login never leave commerce.
    const { loginPasswordEnc: _password, loginUrl: _url, loginUsername: _username, ...rest } = source;
    return rest;
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
