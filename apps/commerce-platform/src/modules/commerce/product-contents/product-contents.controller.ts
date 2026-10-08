import { Controller, Get, Param } from '@nestjs/common';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { ProductContentsService } from './product-contents.service';

/** Product content commerce holds (stage 4b) — admin, MER and graphic (reads). Edits go through the product form. */
@Controller('product-contents')
@StaffRoles('merchandising', 'graphic')
export class ProductContentsController {
  constructor(private readonly contents: ProductContentsService) {}

  @Get(':sku') get(@Param('sku') sku: string) { return this.contents.get(sku); }
}
