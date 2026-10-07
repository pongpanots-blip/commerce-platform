import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';
import { ProductPricesService } from './product-prices.service';

class SkusDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(64, { each: true }) skus!: string[];
}

class EditPriceDto {
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) sellingUnitPrice?: number | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) orderingPrice?: number | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsInt() @Min(0) moq?: number | null;
}

/** Product prices and the MER queue (stage 4a) — admin (the guard's default). */
@Controller('product-prices')
export class ProductPricesController {
  constructor(private readonly prices: ProductPricesService) {}

  @Get() list(@Query('search') search?: string) { return this.prices.list(search); }

  @Get('pending') pending(@Query('search') search?: string) { return this.prices.pending(search); }

  @Post('pending/approve')
  approve(@Body() dto: SkusDto, @Req() req: StaffRequest) { return this.prices.approve(dto.skus, req.staff.userId); }

  @Post('pending/reject')
  reject(@Body() dto: SkusDto) { return this.prices.reject(dto.skus); }

  @Patch(':sku')
  edit(@Param('sku') sku: string, @Body() dto: EditPriceDto, @Req() req: StaffRequest) { return this.prices.edit(sku, dto, req.staff.userId); }
}
