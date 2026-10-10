import { Injectable, Logger } from '@nestjs/common';
import { cronConfig } from '../../../../config/cron.config';
import { MarketingResearchService } from './marketing-research.service';
import { ResearchFreeWorker } from './research-free.worker';
import { ResearchAiWorker } from './research-ai.worker';
import { ScheduledCron } from '../../../../shared-kernel/infrastructure/scheduled-task';

@Injectable()
export class MarketingResearchCron {
  private readonly logger = new Logger(MarketingResearchCron.name);
  constructor(
    private readonly service: MarketingResearchService,
    private readonly worker: ResearchFreeWorker,
    private readonly aiWorker: ResearchAiWorker,
  ) {}

  @ScheduledCron('marketing-research', cronConfig.marketingResearch.expression, {
    timeZone: cronConfig.marketingResearch.timeZone,
    disabled: !cronConfig.marketingResearch.enabled,
  })
  async tick() {
    try {
      await this.service.expireYouTubeEvidence();
    } catch {
      this.logger.error(
        'Research retention cleanup failed; inspect database connectivity',
      );
      return;
    }
    await this.aiWorker.tick();
    try {
      await this.service.queueDue();
      await this.worker.tick();
    } catch {
      this.logger.error(
        'Research scheduler failed; inspect database connectivity and migration status',
      );
    }
  }
}
