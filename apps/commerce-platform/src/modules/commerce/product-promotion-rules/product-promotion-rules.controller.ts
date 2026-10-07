import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';
import { ProductPromotionRulesService } from './product-promotion-rules.service';
@Controller('product-promotion-rules')
export class ProductPromotionRulesController {
  constructor(private readonly service: ProductPromotionRulesService) {}
  @Get('parity') parity() { return this.service.parity(); }
  @Get(':sku') get(@Param('sku') sku: string) { return this.service.get(sku); }
  @Post(':sku') edit(@Param('sku') sku: string, @Body() b: { rules?: unknown }, @Req() req: StaffRequest) { return this.service.edit(sku, b?.rules, req.staff.userId); }
}
