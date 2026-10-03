import { Body, Controller, Get, HttpCode, HttpException, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, ValidationPipe, DefaultValuePipe, BadRequestException } from '@nestjs/common';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { ScrapingService } from '../application/scraping.service';
import { DiscoverScrapingDto, PreviewScrapingDto, SaveScrapingSourceDto, StartScrapingDto } from '../application/dto/scraping.dto';

/**
 * Staff controller for scraping sources and items.
 * Requires bearer token with staff role 'marketing' or 'admin' (global guard).
 */
@Controller('scraping')
@StaffRoles('marketing')
export class ScrapingController {
  constructor(private readonly service: ScrapingService) {}
  private async result<T>(action: () => Promise<T>) {
    try { return { status: 200, data: await action(), message: '' }; }
    catch (error) { return { status: 200, data: [], message: (error as { code?: string }).code === '23505'
      ? 'เว็บนี้มีการตั้งค่าแล้ว เลือกแก้ไขเว็บเดิม' : error instanceof HttpException ? error.message : 'ทำรายการไม่สำเร็จ ตรวจเว็บและการตั้งค่าแล้วลองใหม่' }; }
  }
  @Get('sources') sources() { return this.result(() => this.service.listSources()); }
  @Post('discover') @HttpCode(200)
  discover(@Body(new ValidationPipe({ whitelist: true, transform: true })) dto: DiscoverScrapingDto) { return this.result(() => this.service.discover(dto)); }
  @Post('sources') @HttpCode(200)
  create(@Body(new ValidationPipe({ whitelist: true, transform: true })) dto: SaveScrapingSourceDto) { return this.result(() => this.service.save(dto)); }
  @Put('sources/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: SaveScrapingSourceDto) { return this.result(() => this.service.save(dto, id)); }
  @Post('preview') @HttpCode(200)
  preview(@Body(new ValidationPipe({ whitelist: true, transform: true })) dto: PreviewScrapingDto) { return this.result(() => this.service.preview(dto)); }
  @Post('sources/:id/start') @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: StartScrapingDto) { return this.result(() => this.service.start(id, dto)); }
  @Post('sources/:id/stop') @HttpCode(200)
  stop(@Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: StartScrapingDto) { return this.result(() => this.service.stop(id, dto.revision)); }
  @Get('items')
  items(@Query('sourceId', new ParseUUIDPipe({ optional: true })) sourceId: string | undefined,
    @Query('search') search = '', @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.result(() => {
      if (page < 1 || page > 100000 || typeof search !== 'string') throw new BadRequestException('ระบุหน้ารายการและคำค้นให้ถูกต้อง');
      return this.service.listItems(sourceId, search, page);
    });
  }
  @Get('items/:id') item(@Param('id', ParseUUIDPipe) id: string) { return this.result(() => this.service.item(id)); }
}
