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

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketingResearchTopic, MarketingResearchRun]),
  ],
  controllers: [MarketingResearchController, MarketingResearchWorkerController],
  providers: [
    MarketingResearchService,
    MarketingResearchCron,
    ResearchAccessGuard,
    ResearchWorkerGuard,
  ],
})
export class MarketingResearchModule {}
