import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapingModule } from '../../platform/scraping/scraping.module';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { JoshModule } from '../connector/josh/josh.module';
import { CompetitorPrice } from './competitor-price.entity';
import { CompetitorPricesController } from './competitor-prices.controller';
import { CompetitorPricesService } from './competitor-prices.service';

/** Competitor price comparison (MER) + the josh catalog copy it compares against. Moved from josh. */
@Module({
  imports: [TypeOrmModule.forFeature([CompetitorPrice, JoshCatalogProduct]), ScrapingModule, JoshModule],
  controllers: [CompetitorPricesController],
  providers: [CompetitorPricesService],
  exports: [CompetitorPricesService],
})
export class CompetitorPricesModule {}
