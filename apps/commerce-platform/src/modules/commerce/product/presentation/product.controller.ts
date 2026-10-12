import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ListQueryDto } from '../../../../shared-kernel/application/pagination.dto';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { Product } from '../infrastructure/product.entity';
import { ProductService } from '../application/product.service';
import { CreateProductDto } from '../application/dto/create-product.dto';
import { UpdateProductDto } from '../application/dto/update-product.dto';

/** Merchandise manages the catalog. Graphic may read it; image and content edits are the other controllers. */
@Controller('products')
@StaffRoles('merchandising')
export class ProductController extends BaseCrudController<Product>() {
  constructor(protected readonly service: ProductService) {
    super();
  }

  @Get()
  @StaffRoles('merchandising', 'graphic', 'sale')
  override list(@Query() query: ListQueryDto) {
    return super.list(query);
  }

  @Get(':id')
  @StaffRoles('merchandising', 'graphic', 'sale')
  override get(@Param('id', ParseUUIDPipe) id: string) {
    return super.get(id);
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
