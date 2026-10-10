import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { ManualPriceService } from './manual-price.service';
@Controller('product-prices/editor')
@StaffRoles('merchandising')
export class ManualPriceController {
  constructor(private readonly editor:ManualPriceService) {}
  @Get('items/:sku') item(@Param('sku') sku:string){return this.editor.itemFor(sku);}
  @Post('review') review(@Body() body:unknown){return this.editor.review(body);}
  @Post('actions') save(@Body() body:unknown,@Req() req:StaffRequest){return this.editor.save(body,req.staff.userId);}
  @Get('requests/:id') request(@Param('id') id:string,@Req() req:StaffRequest){return this.editor.request(id,req.staff.userId);}
}
