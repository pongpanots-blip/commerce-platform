import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from '../modules/integration/integration/infrastructure/integration.entity';
import { WebhookEvent } from '../modules/integration/webhook/infrastructure/webhook-event.entity';
import { SyncJob } from '../modules/integration/sync-job/infrastructure/sync-job.entity';
import { OutboxMessage } from '../shared-kernel/infrastructure/outbox.entity';
import { Customer } from '../modules/commerce/customer/infrastructure/customer.entity';
import { Product } from '../modules/commerce/product/infrastructure/product.entity';
import { InventoryLevel } from '../modules/commerce/inventory/infrastructure/inventory-level.entity';
import { ErpIngestRecord } from '../modules/integration/connector/erp/erp-ingest-record.entity';
import { IntegrationModule } from '../modules/integration/integration.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Integration, WebhookEvent, SyncJob, OutboxMessage,
      Customer, Product, InventoryLevel, ErpIngestRecord,
    ]),
    IntegrationModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
