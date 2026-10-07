import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ArrayMaxSize, IsArray, IsUrl } from 'class-validator';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { ImageFile, MAX_GALLERY, ProductImagesService } from './product-images.service';

class GalleryDto {
  @IsArray() @ArrayMaxSize(MAX_GALLERY) @IsUrl({ require_protocol: true }, { each: true }) images!: string[];
}

// Memory storage (no dest): files arrive as buffers. Size / type are checked per file in the service.
const files = (max: number) => FilesInterceptor('images', max, { limits: { fileSize: 6 * 1024 * 1024 } });

/** Product galleries owned by commerce (stage 4e) — admin and MER (stage 6). */
@Controller('product-images')
@StaffRoles('merchandising')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  /** josh's bulk route shape: `images` files named `SKU_<n>.ext`, `mode` append | replace; answer `{ appended, failed }`. */
  @Post('bulk-upload') @HttpCode(HttpStatus.OK) @UseInterceptors(files(10))
  async bulk(@UploadedFiles() uploads: ImageFile[] | undefined, @Body() body: { mode?: string }, @Req() req: StaffRequest) {
    const data = await this.images.bulk(uploads ?? [], body?.mode === 'replace' ? 'replace' : 'append', req.staff.userId);
    return { status: true, statusCode: 200, message: '', data };
  }

  @Get(':sku') get(@Param('sku') sku: string) { return this.images.get(sku); }

  @Post(':sku/upload') @HttpCode(HttpStatus.OK) @UseInterceptors(files(MAX_GALLERY))
  upload(@Param('sku') sku: string, @UploadedFiles() uploads: ImageFile[] | undefined, @Req() req: StaffRequest) {
    return this.images.upload(sku, uploads ?? [], req.staff.userId);
  }

  @Put(':sku') set(@Param('sku') sku: string, @Body() dto: GalleryDto, @Req() req: StaffRequest) {
    return this.images.set(sku, dto.images, req.staff.userId);
  }
}
