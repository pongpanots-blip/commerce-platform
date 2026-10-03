import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, ParseUUIDPipe, Post, Put, Req, ValidationPipe } from '@nestjs/common';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import type { StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';
import { CompetitorPricesService } from './competitor-prices.service';
import { CaptureCompetitorPriceDto, SaveCompetitorPriceDto, VerifyCompetitorPriceDto } from './competitor-price.dto';

/** Same routes and `{ status, data, message }` envelope as josh's /api/competitor-prices. */
@Controller('competitor-prices')
@StaffRoles('marketing')
export class CompetitorPricesController {
  constructor(private readonly service: CompetitorPricesService) {}
  private async result<T>(action: () => Promise<T>) {
    try { return { status: 200, data: await action(), message: '' }; }
    catch (error) {
      const duplicate = (error as { code?: string }).code === '23505';
      return { status: 200, data: [], message: duplicate ? 'SKU นี้ติดตามลิงก์คู่แข่งนี้แล้ว' : error instanceof HttpException ? error.message : 'ทำรายการไม่สำเร็จ กรุณาตรวจระบบฐานข้อมูลและลองใหม่' };
    }
  }

  @Get() list() { return this.result(() => this.service.list()); }
  @Get('catalog/:sku') catalog(@Param('sku') sku: string) { return this.result(() => this.service.catalog(sku)); }
  @Get('suggestions/:catalogItemId')
  suggestions(@Param('catalogItemId', ParseUUIDPipe) catalogItemId: string) { return this.result(() => this.service.suggestions(catalogItemId)); }
  @Get('catalog-items/:id') catalogItem(@Param('id', ParseUUIDPipe) id: string) { return this.result(() => this.service.catalogItem(id)); }
  @Post() @HttpCode(200)
  create(@Body(new ValidationPipe({ whitelist: true, transform: true })) dto: SaveCompetitorPriceDto) {
    return this.result(() => this.service.save(dto));
  }
  @Put(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: SaveCompetitorPriceDto) {
    return this.result(() => this.service.save(dto, id));
  }
  @Post(':id/verify') @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({ whitelist: true })) dto: VerifyCompetitorPriceDto,
    @Req() request: StaffRequest) {
    return this.result(() => this.service.verify(id, dto.matchNote, request.staff.email, dto.revision, dto.ourProductVersion));
  }
  @Post(':id/price') @HttpCode(200)
  capture(@Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({ whitelist: true })) dto: CaptureCompetitorPriceDto) {
    return this.result(() => this.service.capture(id, dto));
  }
  @Post(':id/refresh') @HttpCode(200)
  refresh(@Param('id', ParseUUIDPipe) id: string) { return this.result(() => this.service.refresh(id)); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.result(() => this.service.remove(id)); }
}
