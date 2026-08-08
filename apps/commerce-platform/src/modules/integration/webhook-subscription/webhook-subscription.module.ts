import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WebhookSubscription } from './infrastructure/webhook-subscription.entity';
import { WebhookDelivery } from './infrastructure/webhook-delivery.entity';
import { WebhookSubscriptionService } from './application/webhook-subscription.service';
import { WebhookDispatcher } from './application/webhook-dispatcher';
import { WebhookDeliveryWorker } from './application/webhook-delivery.worker';
import { WebhookSubscriptionController } from './presentation/webhook-subscription.controller';
import { QUEUES } from '../../../config/redis.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookSubscription, WebhookDelivery]),
    BullModule.registerQueue({ name: QUEUES.WEBHOOK_OUT }),
  ],
  controllers: [WebhookSubscriptionController],
  providers: [WebhookSubscriptionService, WebhookDispatcher, WebhookDeliveryWorker],
  exports: [WebhookSubscriptionService],
})
export class WebhookSubscriptionModule {}
