import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../modules/core/auth/auth.module';
import { ApiKeyModule } from '../modules/core/api-key/api-key.module';
import { WebhookSubscription } from '../modules/integration/webhook-subscription/infrastructure/webhook-subscription.entity';
import { WebhookDelivery } from '../modules/integration/webhook-subscription/infrastructure/webhook-delivery.entity';
import { PortalAuthController } from './auth/portal-auth.controller';
import { PortalKeysController } from './keys/portal-keys.controller';
import { PortalWebhooksController } from './webhooks/portal-webhooks.controller';
import { PortalWebhooksService } from './webhooks/portal-webhooks.service';
import { PortalJwtGuard } from './portal-jwt.guard';

@Module({
  imports: [AuthModule, ApiKeyModule, TypeOrmModule.forFeature([WebhookSubscription, WebhookDelivery])],
  controllers: [PortalAuthController, PortalKeysController, PortalWebhooksController],
  providers: [PortalJwtGuard, PortalWebhooksService],
})
export class PortalModule {}
