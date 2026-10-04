import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';
import { EVENT_BUS, IEventBus } from '../../../../../shared-kernel/interfaces/event-bus.interface';
import { IntegrationService } from '../../../integration/application/integration.service';
import { ERP_RELAY_ENTITY_TYPE, ErpIngestRecord } from '../erp-ingest-record.entity';

/** ERP call → event type. The `erp.*` family: the ERP request verbatim, for platforms that run ERP business logic (josh). */
export const ERP_RELAY_EVENTS = {
  productUpsert: 'erp.product.upserted',
  productBulk: 'erp.products.bulk_upserted',
  productImage: 'erp.product.image_updated',
  customer: 'erp.customer.upserted',
  company: 'erp.company.upserted',
  orderStatus: 'erp.order.status_changed',
  invoiceStatus: 'erp.invoice.status_changed',
  quotation: 'erp.quotation.pushed',
  quotationStatus: 'erp.quotation.status_changed',
} as const;
export type ErpRelayEventType = (typeof ERP_RELAY_EVENTS)[keyof typeof ERP_RELAY_EVENTS];

export interface ErpRelayPayload { route: string; externalId: string | null; ingestRecordId: string; erp: unknown }

/** Not a snapshot: order/invoice/quotation history must all arrive (the platform orders and dedupes them). */
export class ErpRelayed extends DomainEvent<ErpRelayPayload> {
  constructor(readonly type: ErpRelayEventType, aggregateId: string, payload: ErpRelayPayload) { super(aggregateId, payload); }
}

const ID_KEYS = ['PRODUCT_CODE', 'product_code', 'DOC_NO', 'orderId', 'quotationId', 'CUSTOMER_CODE', 'CUST_CODE', 'COMPANY_CODE', 'TAX_ID'];

/** Best-effort key for the audit row (lookups / dead-letter search); the platform validates the payload for real. */
export function relayExternalId(body: unknown): string | null {
  const first = Array.isArray(body) ? body[0] : (body as { data?: unknown })?.data ?? body;
  const item = Array.isArray(first) ? first[0] : first;
  if (!item || typeof item !== 'object') return null;
  for (const key of ID_KEYS) {
    const value = (item as Record<string, unknown>)[key];
    if (value != null && value !== '') return String(value).slice(0, 128);
  }
  return null;
}

/**
 * Hub entry for the ERP calls that carry shop business logic (product upsert,
 * customers/companies, order/invoice/quotation status — Tasks 3/4/7). Commerce
 * does not interpret them: it keeps the request verbatim (audit, never lost)
 * and publishes it through the outbox in the same transaction; webhook
 * subscriptions deliver it with retry + dead-letter. josh runs it through the
 * same ERP handlers its /api/erp routes use, so draft products, MER staging,
 * DOC_NO backfill, payment auto-resume etc. stay in josh only.
 */
@Injectable()
export class ErpRelayService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly integrations: IntegrationService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async relay(type: ErpRelayEventType, route: string, body: unknown): Promise<void> {
    if (body == null || typeof body !== 'object' || (Array.isArray(body) && !body.length)) {
      throw new BadRequestException('request body must be a JSON object or a non-empty array');
    }
    const slug = process.env.ERP_INTEGRATION_SLUG?.trim() || 'erp';
    const integration = await this.integrations.resolve(slug);
    // 503 so the ERP retries instead of us silently dropping the call.
    if (!integration) throw new ServiceUnavailableException(`ERP integration "${slug}" is not configured`);

    const externalId = relayExternalId(body);
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ErpIngestRecord);
      const record = await repo.save(repo.create({
        integrationId: integration.id, entityType: ERP_RELAY_ENTITY_TYPE, externalId, rawPayload: body,
        parsedPayload: { eventType: type, route }, status: 'applied', appliedAt: new Date(),
      }));
      await this.eventBus.publish(new ErpRelayed(type, record.id, { route, externalId, ingestRecordId: record.id, erp: body }), manager);
    });
  }
}
