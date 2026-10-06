import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JoshModule } from '../connector/josh/josh.module';
import { MarketingResearchModule } from '../../platform/marketing-research/marketing-research.module';
import { GrowthCampaignPlan } from './growth-plan.entity';
import { GrowthController } from './growth.controller';
import { GrowthService } from './growth.service';
import { GrowthDataService } from './growth-data.service';
import { GrowthAiService } from './growth-ai.service';
import { MarketAnalysis } from './market-analysis.entity';

@Module({ imports: [TypeOrmModule.forFeature([GrowthCampaignPlan, MarketAnalysis]), JoshModule, MarketingResearchModule],
  controllers: [GrowthController], providers: [GrowthService, GrowthDataService, GrowthAiService], exports: [GrowthService, GrowthDataService] })
export class GrowthModule {}
