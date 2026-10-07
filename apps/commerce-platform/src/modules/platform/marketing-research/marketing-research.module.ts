import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketingResearchTopic } from './infrastructure/marketing-research-topic.entity';
import { MarketingResearchRun } from './infrastructure/marketing-research-run.entity';
import {
  MarketingResearchController,
  MarketingResearchWorkerController,
} from './presentation/marketing-research.controller';
import { MarketingResearchCron } from './application/marketing-research.cron';
import { MarketingResearchService } from './application/marketing-research.service';
import { ResearchAccessGuard, ResearchWorkerGuard } from './presentation/research.guards';
import { ResearchCatalogService } from './application/research-catalog.service';
import { ResearchFreeWorker } from './application/research-free.worker';
import { ResearchAiSummaryService } from './application/research-ai-summary.service';
import { ResearchAiWorker } from './application/research-ai.worker';
import { ResearchSocialService } from './application/research-social.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketingResearchTopic, MarketingResearchRun]),
  ],
  controllers: [MarketingResearchController, MarketingResearchWorkerController],
  providers: [
    MarketingResearchService,
    MarketingResearchCron,
    ResearchCatalogService,
    ResearchFreeWorker,
    ResearchAiSummaryService,
    ResearchAiWorker,
    ResearchSocialService,
    ResearchAccessGuard,
    ResearchWorkerGuard,
  ],
  exports: [MarketingResearchService],
})
export class MarketingResearchModule {}
