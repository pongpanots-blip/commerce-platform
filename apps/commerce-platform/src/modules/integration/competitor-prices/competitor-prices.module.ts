import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapingModule } from '../../platform/scraping/scraping.module';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { JoshCatalogSyncService } from '../connector/josh/josh-catalog-sync.service';
import { CompetitorPrice } from './competitor-price.entity';
import { CompetitorPricesController } from './competitor-prices.controller';
import { CompetitorPricesService } from './competitor-prices.service';

/** Competitor price comparison (MER) + the josh catalog copy it compares against. Moved from josh. */
@Module({
  imports: [TypeOrmModule.forFeature([CompetitorPrice, JoshCatalogProduct]), ScrapingModule],
  controllers: [CompetitorPricesController],
  providers: [CompetitorPricesService, JoshCatalogSyncService],
  exports: [CompetitorPricesService],
})
export class CompetitorPricesModule {}
