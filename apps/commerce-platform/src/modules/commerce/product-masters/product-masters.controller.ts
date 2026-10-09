import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { QueuePageQuery, queuePage } from '../queue-page';
import { ProductMastersService } from './product-masters.service';

class SkusDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(64, { each: true }) skus!: string[];
}

/** The ERP product master queue (stage 4d) — admin and MER (stage 6). Staff edits go through the product form. */
@Controller('product-masters')
@StaffRoles('merchandising')
export class ProductMastersController {
  constructor(private readonly masters: ProductMastersService) {}

  /** `page`/`limit` → `{ items, total, page, limit }` (20/100); neither → the bare array (newest 500). */
  @Get('pending') pending(@Query() q: QueuePageQuery, @Query('search') search?: string) { return this.masters.pending(search, queuePage(q)); }

  @Post('pending/approve')
  approve(@Body() dto: SkusDto, @Req() req: StaffRequest) { return this.masters.approve(dto.skus, req.staff.userId); }

  @Post('pending/reject')
  reject(@Body() dto: SkusDto) { return this.masters.reject(dto.skus); }

  @Get(':sku') get(@Param('sku') sku: string) { return this.masters.get(sku); }
}
