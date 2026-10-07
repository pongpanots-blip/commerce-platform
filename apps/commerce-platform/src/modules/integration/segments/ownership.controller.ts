import { Controller, Get } from '@nestjs/common';
import { ownsSalesReps } from '../customers/sales-reps.service';
import { ownsSegments } from './segments.service';
import { ownsPrices } from '../../commerce/product-prices/product-prices.service';
import { ownsProductContent } from '../../commerce/product-contents/product-contents.service';
import { ownsCategories } from '../../commerce/product-categories/product-categories.service';
import { ownsProductMaster } from '../../commerce/product-masters/product-masters.service';

/**
 * Which josh features commerce owns right now (any signed-in staff). commerce-admin's hosted josh pages read it
 * to send writes to commerce or to josh — so switching ownership is an env change, not a UI deploy.
 */
@Controller('ownership')
export class OwnershipController {
  @Get() get() { return { segments: ownsSegments(), salesReps: ownsSalesReps(), prices: ownsPrices(), productContent: ownsProductContent(), categories: ownsCategories(), productMaster: ownsProductMaster() }; }
}
