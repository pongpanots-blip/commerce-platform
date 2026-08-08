import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration } from '../../integration/infrastructure/integration.entity';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { DomainEvent } from '../../../../shared-kernel/domain/domain-event';
import { ErpIngestEntityType } from './erp-ingest-record.entity';
import { ErpIngestService } from './ingest/erp-ingest.service';

/** Canonical events re-published from raw ERP webhooks. */
class ErpSaleOrderCreated extends DomainEvent { readonly type = 'erp.sale-order.created'; }
class ErpInventoryUpdated extends DomainEvent { readonly type = 'inventory.updated'; }
class ErpProductUpdated extends DomainEvent { readonly type = 'product.updated'; }
class ErpCustomerUpdated extends DomainEvent { readonly type = 'customer.updated'; }

const EVENT_MAP: Record<string, new (a: string, p: unknown) => DomainEvent> = {
  'sale_order.created': ErpSaleOrderCreated,
  'stock.changed': ErpInventoryUpdated,
  'product.changed': ErpProductUpdated,
  'customer.changed': ErpCustomerUpdated,
};

/**
 * Which ingest entityType each ERP event_type stages as, and which nested key
 * of the raw payload holds the actual data object (falling back to the rest
 * of the payload — minus event_type — when the ERP sends it flat).
 */
const DATA_KEYS: Record<string, [ErpIngestEntityType, string]> = {
  'product.changed': ['product', 'item'],
  'stock.changed': ['stock', 'onhand'],
  'customer.changed': ['customer', 'account'],
  'sale_order.created': ['sale_order', 'order'],
};

/**
 * Inbound half of the ERP integration (brief §3.4): ERP posts to the existing
 * POST /webhooks/erp endpoint; the pipeline verifies/persists/retries and emits
 * integration.webhook.received; THIS class translates ERP payloads into
 * canonical platform events (e.g. sale orders placed by sales staff directly in
 * the ERP become visible on the platform event stream within seconds).
 * Unknown event types are logged and skipped — never poison the pipeline.
 */
@Injectable()
export class ErpEventProcessor {
  private readonly logger = new Logger(ErpEventProcessor.name);

  constructor(
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
    private readonly ingest: ErpIngestService,
  ) {}

  @OnEvent('integration.webhook.received')
  async onWebhookReceived(event: {
    aggregateId: string;
    payload: { webhookEventId: string; payload: unknown };
  }): Promise<void> {
    const integration = await this.integrations.findOne({ where: { id: event.aggregateId } });
    if (integration?.type !== 'erp') return;

    const raw = (event.payload.payload ?? {}) as { event_type?: string } & Record<string, unknown>;
    const EventClass = raw.event_type ? EVENT_MAP[raw.event_type] : undefined;
    if (!EventClass) {
      this.logger.warn(`unhandled ERP event_type "${raw.event_type}" (webhook ${event.payload.webhookEventId})`);
      return;
    }

    const { event_type, ...rest } = raw;
    await this.eventBus.publish(
      new EventClass(event.aggregateId, { webhookEventId: event.payload.webhookEventId, ...rest }),
    );
    this.logger.log(`ERP ${event_type} → ${new EventClass('', {}).type}`);

    // Also route the raw data payload into ingestion (stage + auto-apply per
    // policy) so ERP-originated changes land in the platform's own catalog,
    // stock, customer, and (store-only) sale-order records — independent of
    // whatever else subscribes to the canonical event above.
    const [entityType, dataKey] = DATA_KEYS[event_type as string] ?? [];
    if (entityType) {
      await this.ingest.stageAndApply(event.aggregateId, entityType, raw[dataKey] ?? rest);
    }
  }
}
