import { Module } from '@nestjs/common';
import { ProductContentsController } from './product-contents.controller';
import { ProductContentsService } from './product-contents.service';

/** Product content owned by commerce (stage 4b). */
@Module({
  controllers: [ProductContentsController],
  providers: [ProductContentsService],
  exports: [ProductContentsService],
})
export class ProductContentsModule {}
