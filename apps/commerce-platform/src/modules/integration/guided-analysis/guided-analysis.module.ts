import { Module } from '@nestjs/common';
import { GuidedAnalysisController } from './guided-analysis.controller';
import { GuidedAnalysisService } from './guided-analysis.service';

/** Read-only template validation. No database, collector, grant registry or operational writer is registered. */
@Module({ controllers: [GuidedAnalysisController], providers: [GuidedAnalysisService] })
export class GuidedAnalysisModule {}
