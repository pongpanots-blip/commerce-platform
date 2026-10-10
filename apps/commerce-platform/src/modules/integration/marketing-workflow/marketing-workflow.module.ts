import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUES } from '../../../config/redis.config';
import { SettingsModule } from '../../core/settings/settings.module';
import { JoshModule } from '../connector/josh/josh.module';
import { MarketingEventsModule } from '../marketing-events/marketing-events.module';
import { SegmentsModule } from '../segments/segments.module';
import { WebhookDelivery } from '../webhook-subscription/infrastructure/webhook-delivery.entity';
import { MarketingWebhookWorker } from './application/marketing-webhook.worker';
import { WebhookSecretsService } from './application/webhook-secrets.service';
import { WorkflowAnalyticsService } from './application/workflow-analytics.service';
import { WorkflowEngine } from './application/workflow-engine.service';
import { WorkflowProcessor } from './application/workflow.processor';
import { WorkflowQueue } from './application/workflow-queue';
import { WorkflowService } from './application/workflow.service';
import { WorkflowSweep } from './application/workflow-sweep';
import { WorkflowTriggerListener } from './application/workflow-trigger.listener';
import { WorkflowTriggers } from './application/workflow-triggers.service';
import { MarketingWebhookSecret } from './infrastructure/marketing-webhook-secret.entity';
import { MarketingWorkflowRevisionRow } from './infrastructure/marketing-workflow-revision.entity';
import { MarketingWorkflowRow } from './infrastructure/marketing-workflow.entity';
import { WorkflowStore } from './infrastructure/workflow.store';
import { MarketingWorkflowController } from './presentation/marketing-workflow.controller';

/** Commerce-run marketing workflows, phase 1 (spec 2026-10-10). */
@Module({
  imports: [
    TypeOrmModule.forFeature([MarketingWorkflowRow, MarketingWorkflowRevisionRow, MarketingWebhookSecret, WebhookDelivery]),
    BullModule.registerQueue({ name: QUEUES.MARKETING }, { name: QUEUES.MARKETING_WEBHOOK }),
    SegmentsModule, SettingsModule, JoshModule, MarketingEventsModule,
  ],
  controllers: [MarketingWorkflowController],
  providers: [WorkflowStore, WorkflowQueue, WorkflowEngine, WorkflowTriggers, WorkflowTriggerListener, WorkflowProcessor, WorkflowSweep,
    MarketingWebhookWorker, WebhookSecretsService, WorkflowService, WorkflowAnalyticsService],
})
export class MarketingWorkflowModule {}
