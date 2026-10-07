import { Controller, Get, Param } from '@nestjs/common';
import { ProductContentsService } from './product-contents.service';

/** Product content commerce holds (stage 4b) — admin (the guard's default). Edits go through the product form (JoshActionsController). */
@Controller('product-contents')
export class ProductContentsController {
  constructor(private readonly contents: ProductContentsService) {}

  @Get(':sku') get(@Param('sku') sku: string) { return this.contents.get(sku); }
}
