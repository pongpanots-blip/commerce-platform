import { Module } from '@nestjs/common';
import { ProductImagesController } from './product-images.controller';
import { ProductImagesService } from './product-images.service';

/** Product galleries owned by commerce (stage 4e). */
@Module({
  controllers: [ProductImagesController],
  providers: [ProductImagesService],
  exports: [ProductImagesService],
})
export class ProductImagesModule {}
