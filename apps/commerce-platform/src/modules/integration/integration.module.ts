import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from './integration/infrastructure/integration.entity';
import { ConnectorRegistry } from './connector/connector-registry';
import { ExampleConnector } from './connector/example/example.connector';
import { ErpStubConnector } from './connector/erp-stub/erp-stub.connector';
import { ErpStubStockController } from './connector/erp-stub/erp-stub-stock.controller';
import { ErpStubStock } from './connector/erp-stub/erp-stub-stock.entity';
import { ErpStubReservation } from './connector/erp-stub/erp-stub-reservation.entity';
import { ErpHttpClient } from './connector/erp/erp-http.client';
import { ErpConnector } from './connector/erp/erp.connector';
import { ErpEventProcessor } from './connector/erp/erp-event.processor';
import { ErpOrderPushSubscriber } from './connector/erp/erp-order-push.subscriber';
import { ErpIngestRecord } from './connector/erp/erp-ingest-record.entity';
import { ErpIngestService } from './connector/erp/ingest/erp-ingest.service';
import { IntegrationService } from './integration/application/integration.service';
import { IntegrationController } from './integration/presentation/integration.controller';
import { MappingModule } from './mapping/mapping.module';
import { SettingsModule } from '../core/settings/settings.module';
import { InventoryModule } from '../commerce/inventory/inventory.module';
import { ErpFeedController } from './connector/erp/presentation/erp-feed.controller';
import { ErpFeedService } from './connector/erp/ingest/erp-feed.service';
import { ErpRelayController } from './connector/erp/presentation/erp-relay.controller';
import { AccountingRelayController } from './connector/erp/presentation/accounting-relay.controller';
import { ErpSimulatorController } from './connector/erp/presentation/erp-simulator.controller';
import { ErpRelayService } from './connector/erp/ingest/erp-relay.service';

/**
 * Owns the single {@link ConnectorRegistry} and registers the built-in
 * connectors at startup. Future connectors are added to `providers` and the
 * `onModuleInit` registration below. Also exposes admin management of
 * integrations.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Integration, ErpStubStock, ErpStubReservation, ErpIngestRecord]), MappingModule, SettingsModule, InventoryModule],
  controllers: [IntegrationController, ErpStubStockController, ErpFeedController, ErpRelayController, AccountingRelayController, ErpSimulatorController],
  providers: [ConnectorRegistry, ExampleConnector, ErpStubConnector, ErpHttpClient, ErpConnector, ErpEventProcessor, ErpOrderPushSubscriber, IntegrationService, ErpIngestService, ErpFeedService, ErpRelayService],
  exports: [ConnectorRegistry, IntegrationService, TypeOrmModule, ErpHttpClient, ErpIngestService],
})
export class IntegrationModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly example: ExampleConnector,
    private readonly erpStub: ErpStubConnector,
    private readonly erp: ErpConnector,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.example.type, this.example);
    this.registry.register(this.erpStub.type, this.erpStub);
    this.registry.register(this.erp.type, this.erp);
  }
}
