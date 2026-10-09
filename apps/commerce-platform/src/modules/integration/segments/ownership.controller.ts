import { Controller, Get } from '@nestjs/common';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { ownsSalesReps } from '../customers/sales-reps.service';
import { ownsStaff } from '../customers/josh-staff-access.service';
import { ownsSegments } from './segments.service';
import { ownsPrices } from '../../commerce/product-prices/product-prices.service';
import { ownsProductContent } from '../../commerce/product-contents/product-contents.service';
import { ownsCategories } from '../../commerce/product-categories/category-rules';
import { ownsProductMaster } from '../../commerce/product-masters/product-masters.service';
import { ownsPromotions } from '../../commerce/product-promotion-rules/product-promotion-rules.service';
import { ownsProductImages } from '../../commerce/product-images/product-images.service';
import { ownsOrdering } from '../../commerce/ordering/ordering.service';

/**
 * Which josh features commerce owns right now (any signed-in staff). commerce-admin's hosted josh pages read it
 * to send writes to commerce or to josh — so switching ownership is an env change, not a UI deploy.
 * Open to every staff role: without it a non-admin page falls back to josh's routes, which josh refuses once owned.
 */
@Controller('ownership')
@StaffRoles('marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic')
export class OwnershipController {
  @Get() get() { return { segments: ownsSegments(), salesReps: ownsSalesReps(), prices: ownsPrices(), productContent: ownsProductContent(), categories: ownsCategories(), productMaster: ownsProductMaster(), productImages: ownsProductImages(), promotions: ownsPromotions(), ordering: ownsOrdering(), staff: ownsStaff() }; }
}
