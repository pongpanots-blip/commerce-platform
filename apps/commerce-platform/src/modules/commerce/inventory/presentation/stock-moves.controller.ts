import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { ADJUST_REASONS, AdjustReason, StockMovesService } from '../application/stock-moves.service';

class AdjustStockDto {
  @IsString() @MinLength(1) @MaxLength(64) sku!: string;
  @IsString() @MinLength(1) @MaxLength(64) warehouseCode!: string;
  @IsIn(['set', 'add']) mode!: 'set' | 'add';
  @IsInt() @Min(-1_000_000) @Max(1_000_000) quantity!: number;
  @IsIn(ADJUST_REASONS as unknown as string[]) reason!: AdjustReason;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class TransferStockDto {
  @IsString() @MinLength(1) @MaxLength(64) sku!: string;
  @IsString() @MinLength(1) @MaxLength(64) fromWarehouseCode!: string;
  @IsString() @MinLength(1) @MaxLength(64) toWarehouseCode!: string;
  @IsInt() @Min(1) @Max(1_000_000) quantity!: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/** Receive / count / transfer for warehouses commerce owns (admin — the guard's default). Stage 3. */
@Controller('stock')
export class StockMovesController {
  constructor(private readonly moves: StockMovesService) {}

  @Get('warehouses') @StaffRoles('merchandising') warehouses() { return this.moves.warehouses(); }

  @Post('adjustments') @StaffRoles('merchandising')
  adjust(@Body() dto: AdjustStockDto, @Req() req: StaffRequest) { return this.moves.adjust(dto, req.staff.userId); }

  /** Cutover / repair: send every SKU's sellable stock to the platforms again. */
  @Post('sellable-snapshots/resend')
  resend() { return this.moves.resendSellable(); }

  @Post('transfers') @StaffRoles('merchandising')
  transfer(@Body() dto: TransferStockDto, @Req() req: StaffRequest) { return this.moves.transfer(dto, req.staff.userId); }
}
