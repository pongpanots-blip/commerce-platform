import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DomainEvent } from '../../../../../shared-kernel/domain/domain-event';
import { EVENT_BUS, IEventBus } from '../../../../../shared-kernel/interfaces/event-bus.interface';
import { IntegrationService } from '../../../integration/application/integration.service';
import { ERP_RELAY_ENTITY_TYPE, ErpIngestRecord } from '../erp-ingest-record.entity';
import { ProductMastersService } from '../../../../commerce/product-masters/product-masters.service';
import { ProductImagesService } from '../../../../commerce/product-images/product-images.service';

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
  orderPeriods: 'erp.order_periods.pushed',
  // Accounting webhooks josh takes outside /erp (CS-CRM claim → credit note, ERP invoice under order → credit back).
  creditNote: 'erp.credit_note.claim_approved',
  creditBack: 'erp.credit_back.invoice_received',
  // CS-CRM webhooks josh takes (identity verification decision, agent reply in the shop chat).
  kycDecision: 'cs.kyc.decided',
  livechatOutbound: 'cs.livechat.outbound',
} as const;
export type ErpRelayEventType = (typeof ERP_RELAY_EVENTS)[keyof typeof ERP_RELAY_EVENTS];

export interface ErpRelayPayload { route: string; externalId: string | null; ingestRecordId: string; erp: unknown }

/**
 * Not a snapshot by default: order/invoice/quotation history must all arrive (the platform orders and dedupes them).
 * With a `snapshotKey` the call is a full replace of that key (order periods per SUP_CODE): latest wins, so a
 * retried older push never rolls the platform back.
 */
export class ErpRelayed extends DomainEvent<ErpRelayPayload> {
  constructor(readonly type: ErpRelayEventType, aggregateId: string, payload: ErpRelayPayload, snapshot = false) {
    super(aggregateId, payload, snapshot ? { snapshot: true } : {});
  }
}

/**
 * Order-period push = the full round list of each SUP_CODE in it (josh closes the rest), so pushes for the
 * same supplier set are latest-wins. ponytail: keyed on the exact SUP_CODE set — an older mixed push {A,B}
 * retried after a newer {A} still lands; per-supplier split if the ERP starts mixing suppliers.
 */
export function orderPeriodSnapshotKey(body: unknown): string | null {
  if (!Array.isArray(body)) return null;
  const codes = body.map((row) => String((row as { SUP_CODE?: unknown })?.SUP_CODE ?? '').trim());
  if (codes.some((c) => !c)) return null;
  // aggregate_id is a uuid column: a stable uuid-shaped hash of the key.
  const h = createHash('sha256').update(`order-periods:${[...new Set(codes)].sort().join(',')}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const ID_KEYS = ['cnNumber', 'invoiceNumber', 'externalMessageId', 'documentId', 'PRODUCT_CODE', 'SUP_CODE', 'product_code', 'DOC_NO', 'orderId', 'quotationId', 'CUSTOMER_CODE', 'CUST_CODE', 'COMPANY_CODE', 'TAX_ID'];

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
    /** Stage 4d: ERP product upserts also wait in commerce's MER queue once it owns the product master. */
    @Optional() private readonly masters?: ProductMastersService,
    /** Stage 4e: ERP image calls replace the gallery commerce owns. */
    @Optional() private readonly images?: ProductImagesService,
  ) {}

  async relay(type: ErpRelayEventType, route: string, body: unknown, snapshotKey: string | null = null): Promise<void> {
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
      const payload = { route, externalId, ingestRecordId: record.id, erp: body };
      await this.eventBus.publish(new ErpRelayed(type, snapshotKey ?? record.id, payload, !!snapshotKey), manager);
      if (type === ERP_RELAY_EVENTS.productUpsert || type === ERP_RELAY_EVENTS.productBulk) await this.masters?.stageFromErp(manager, body, new Date());
      if (type === ERP_RELAY_EVENTS.productImage) await this.images?.fromErp(manager, body);
    });
  }
}
