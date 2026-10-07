import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { CreateCategoryDto, OrderedIdsDto, UpdateBrandDto, UpdateCategoryDto } from './product-categories.dto';
import { ProductCategoriesService } from './product-categories.service';

/** josh's category write routes on commerce (stage 4c) — admin and MER (stage 6). Reads stay on josh. */
@Controller('product-category')
@StaffRoles('merchandising')
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Post() create(@Body() dto: CreateCategoryDto) { return this.categories.create(dto); }

  @Put('level1-order') reorderLevel1(@Body() dto: OrderedIdsDto) { return this.categories.reorderLevel1(dto.orderedIds); }

  @Put(':id/children-order')
  reorderChildren(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderedIdsDto) { return this.categories.reorderChildren(id, dto.orderedIds); }

  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) { return this.categories.update(id, dto); }

  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.categories.remove(id); }
}

/** josh's brand edit on commerce (stage 4c): names only. */
@Controller('brands')
@StaffRoles('merchandising')
export class ProductBrandsController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto, @Req() req: StaffRequest) {
    return this.categories.updateBrand(id, dto, req.staff.userId);
  }
}
