import { Controller, Get, Param } from '@nestjs/common';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { ProductContentsService } from './product-contents.service';

/** Product content commerce holds (stage 4b) — admin and MER (stage 6). Edits go through the product form (JoshActionsController). */
@Controller('product-contents')
@StaffRoles('merchandising')
export class ProductContentsController {
  constructor(private readonly contents: ProductContentsService) {}

  @Get(':sku') get(@Param('sku') sku: string) { return this.contents.get(sku); }
}
