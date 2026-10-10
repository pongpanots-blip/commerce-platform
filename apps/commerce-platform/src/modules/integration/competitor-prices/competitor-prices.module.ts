import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapingModule } from '../../platform/scraping/scraping.module';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { JoshModule } from '../connector/josh/josh.module';
import { CompetitorMatchRejection, CompetitorMatchReview, CompetitorPrice } from './competitor-price.entity';
import { CompetitorPricesController } from './competitor-prices.controller';
import { CompetitorPricesService } from './competitor-prices.service';
import { CompetitorReviewService } from './competitor-review.service';
import { PackPlanningController } from '../pack-price-planning/pack-planning.controller';
import { PackInputsService } from '../pack-price-planning/pack-inputs.service';
import { PackDraftsService } from '../pack-price-planning/pack-drafts.service';
import { ComparisonWorkspaceController } from './comparison-workspace.controller';
import { ComparisonWorkspaceService } from './comparison-workspace.service';

/** Competitor price comparison (MER) + the josh catalog copy it compares against. Moved from josh. */
@Module({
  imports: [TypeOrmModule.forFeature([CompetitorPrice, CompetitorMatchRejection, CompetitorMatchReview, JoshCatalogProduct]), ScrapingModule, JoshModule],
  controllers: [CompetitorPricesController, PackPlanningController, ComparisonWorkspaceController],
  providers: [CompetitorPricesService, CompetitorReviewService, PackInputsService, PackDraftsService, ComparisonWorkspaceService],
  exports: [CompetitorPricesService],
})
export class CompetitorPricesModule {}
