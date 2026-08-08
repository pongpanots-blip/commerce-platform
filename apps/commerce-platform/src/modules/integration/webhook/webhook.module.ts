import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WebhookEvent } from './infrastructure/webhook-event.entity';
import { WebhookReceiverService } from './application/webhook-receiver.service';
import { WebhookProcessor } from './application/webhook-processor.worker';
import { SignatureVerifier } from './application/signature-verifier';
import { WebhookController } from './presentation/webhook.controller';
import { IntegrationModule } from '../integration.module';
import { QUEUES } from '../../../config/redis.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent]),
    BullModule.registerQueue({ name: QUEUES.WEBHOOK }),
    IntegrationModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookReceiverService, WebhookProcessor, SignatureVerifier],
  exports: [WebhookReceiverService],
})
export class WebhookModule {}
