import { Injectable, Logger } from '@nestjs/common';
import { MarketingResearchService } from './marketing-research.service';
import { ResearchAiSummaryService } from './research-ai-summary.service';

/** Consumes only summaries explicitly requested by Marketing; report JSON holds the durable lease. */
@Injectable()
export class ResearchAiWorker {
  private readonly logger = new Logger(ResearchAiWorker.name);
  private running = false;
  constructor(
    private readonly service: MarketingResearchService,
    private readonly ai: ResearchAiSummaryService,
  ) {}
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const run = await this.service.claimSummary();
      const claim = run?.report?.analysis;
      if (!run?.report || !claim?.requestId || !claim.attempts) return;
      const analysis = await this.ai.summarize(run.scope, run.report);
      await this.service.finishSummary(
        run.id,
        claim.requestId,
        claim.attempts,
        analysis,
      );
    } catch {
      this.logger.warn(
        'Research AI summary was not saved; queued jobs recover after their lease expires',
      );
    } finally {
      this.running = false;
    }
  }
}
