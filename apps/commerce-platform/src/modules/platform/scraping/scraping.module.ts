import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapingSource, ScrapedItem } from './domain/scraping-source.entity';
import { Setting } from '../../core/settings/infrastructure/setting.entity';
import { ScrapingService } from './application/scraping.service';
import { PublicWebReader } from './infrastructure/public-web.reader';
import { ScrapingController } from './presentation/scraping.controller';
import { ScrapingInternalController } from './presentation/scraping-internal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ScrapingSource, ScrapedItem, Setting])],
  providers: [ScrapingService, PublicWebReader],
  controllers: [ScrapingController, ScrapingInternalController],
  exports: [ScrapingService],
})
export class ScrapingModule {}
