import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cronConfig } from '../../../../config/cron.config';
import { MarketingResearchService } from './marketing-research.service';

@Injectable()
export class MarketingResearchCron {
  private readonly logger = new Logger(MarketingResearchCron.name);
  constructor(private readonly service: MarketingResearchService) {}

  @Cron(cronConfig.marketingResearch.expression, {
    timeZone: cronConfig.marketingResearch.timeZone,
    disabled: !cronConfig.marketingResearch.enabled,
  })
  async tick() {
    try {
      await this.service.queueDue();
    } catch {
      this.logger.error(
        'Research scheduler failed; inspect database connectivity and migration status',
      );
    }
  }
}
