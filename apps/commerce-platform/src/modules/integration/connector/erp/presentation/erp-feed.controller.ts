import { Body, Controller, HttpCode, HttpStatus, Put, UseGuards } from '@nestjs/common';
import { ErpKeyGuard } from './erp-key.guard';
import { SingleOrArrayPipe } from './single-or-array.pipe';
import { ProductMoqItemDto, ProductPriceItemDto, ProductQtyItemDto } from './erp-feed.dto';
import { ErpFeedService } from '../ingest/erp-feed.service';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';

/**
 * ERP → hub feed. Same paths, auth header and wire shape as josh's
 * ErpWebhookController (/api/erp/*), so nginx can send ERP here first and fall
 * back to josh without the ERP noticing. Answers as soon as the payload is
 * staged — never waits on a downstream platform.
 */
@UseGuards(ErpKeyGuard)
// Own auth (or health) — skip the global staff guard.
@Public()
@Controller('erp')
export class ErpFeedController {
  constructor(private readonly feed: ErpFeedService) {}

  /** event: product.qty.changed */
  @Put('products/qty')
  @HttpCode(HttpStatus.OK)
  async qty(@Body(new SingleOrArrayPipe(ProductQtyItemDto)) items: ProductQtyItemDto[]) {
    await this.feed.receive('qty', items);
    return { received: true };
  }

  /** event: product.price.changed */
  @Put('products/price')
  @HttpCode(HttpStatus.OK)
  async price(@Body(new SingleOrArrayPipe(ProductPriceItemDto)) items: ProductPriceItemDto[]) {
    await this.feed.receive('price', items);
    return { received: true };
  }

  /** event: product.moq.changed */
  @Put('products/moq')
  @HttpCode(HttpStatus.OK)
  async moq(@Body(new SingleOrArrayPipe(ProductMoqItemDto)) items: ProductMoqItemDto[]) {
    await this.feed.receive('moq', items);
    return { received: true };
  }
}
