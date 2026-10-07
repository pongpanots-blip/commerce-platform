import { Module } from '@nestjs/common';
import { ProductBrandsController, ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';

/** The shop's category tree and brand names, owned by commerce (stage 4c). */
@Module({
  controllers: [ProductCategoriesController, ProductBrandsController],
  providers: [ProductCategoriesService],
})
export class ProductCategoriesModule {}
