import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { ProductMastersService } from './product-masters.service';

class SkusDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(64, { each: true }) skus!: string[];
}

/** The ERP product master queue (stage 4d) — admin and MER (stage 6). Staff edits go through the product form. */
@Controller('product-masters')
@StaffRoles('merchandising')
export class ProductMastersController {
  constructor(private readonly masters: ProductMastersService) {}

  @Get('pending') pending(@Query('search') search?: string) { return this.masters.pending(search); }

  @Post('pending/approve')
  approve(@Body() dto: SkusDto, @Req() req: StaffRequest) { return this.masters.approve(dto.skus, req.staff.userId); }

  @Post('pending/reject')
  reject(@Body() dto: SkusDto) { return this.masters.reject(dto.skus); }

  @Get(':sku') get(@Param('sku') sku: string) { return this.masters.get(sku); }
}
