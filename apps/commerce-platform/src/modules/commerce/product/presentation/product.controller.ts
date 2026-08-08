import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { Product } from '../infrastructure/product.entity';
import { ProductService } from '../application/product.service';
import { CreateProductDto } from '../application/dto/create-product.dto';
import { UpdateProductDto } from '../application/dto/update-product.dto';

@Controller('products')
export class ProductController extends BaseCrudController<Product>() {
  constructor(protected readonly service: ProductService) {
    super();
  }

  @Post()
  override create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  override update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(id, dto);
  }
}
