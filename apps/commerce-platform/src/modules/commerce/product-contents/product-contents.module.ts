import { Module } from '@nestjs/common';
import { ProductContentsController } from './product-contents.controller';
import { ProductContentsService } from './product-contents.service';
import { ProductContentEditorController } from '../product-content-editor/product-content-editor.controller';
import { ProductContentEditorService } from '../product-content-editor/product-content-editor.service';

/** Product content owned by commerce (stage 4b). */
@Module({
  controllers: [ProductContentsController, ProductContentEditorController],
  providers: [ProductContentsService, ProductContentEditorService],
  exports: [ProductContentsService, ProductContentEditorService],
})
export class ProductContentsModule {}
