import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cronConfig } from '../../../../config/cron.config';
import { MarketingResearchService } from './marketing-research.service';
import { ResearchFreeWorker } from './research-free.worker';

@Injectable()
export class MarketingResearchCron {
  private readonly logger = new Logger(MarketingResearchCron.name);
  constructor(
    private readonly service: MarketingResearchService,
    private readonly worker: ResearchFreeWorker,
  ) {}

  @Cron(cronConfig.marketingResearch.expression, {
    timeZone: cronConfig.marketingResearch.timeZone,
    disabled: !cronConfig.marketingResearch.enabled,
  })
  async tick() {
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
