import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ErpFeedEntityType, ErpIngestRecord } from '../erp-ingest-record.entity';
import { ErpIngestService } from './erp-ingest.service';
import { ParsedFeedMoq, ParsedFeedPrice, ParsedFeedQty } from './erp-payload.parsers';
import { InventoryQtyChanged, ProductMoqChanged, ProductPriceChanged } from './erp-feed.events';
import { IntegrationService } from '../../../integration/application/integration.service';
import { MappingService } from '../../../mapping/application/mapping.service';
import { InventoryLedgerService } from '../../../../commerce/inventory/application/inventory-ledger.service';
import { Product } from '../../../../commerce/product/infrastructure/product.entity';
import { Warehouse } from '../../../../commerce/warehouse/infrastructure/warehouse.entity';
import { EVENT_BUS, IEventBus } from '../../../../../shared-kernel/interfaces/event-bus.interface';

export type ErpFeedKind = 'qty' | 'price' | 'moq';

const ENTITY_TYPE: Record<ErpFeedKind, ErpFeedEntityType> = {
  qty: 'product_qty', price: 'product_price', moq: 'product_moq',
};

/**
 * Hub entry for the Jagota feed (PUT /erp/products/{qty,price,moq}).
 *
 * Per item: stage verbatim (audit, never lost) → in ONE transaction record the
 * stock movement (qty only) and publish the canonical event to the outbox →
 * webhook subscriptions fan it out to every platform (josh first). The ERP is
 * answered as soon as staging is done; no platform is waited on (§0.1).
 *
 * Business rules (draft products, MER price staging, sellable cache) stay in
 * each platform — this service only records and distributes.
 */
@Injectable()
export class ErpFeedService {
  private readonly logger = new Logger(ErpFeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ingest: ErpIngestService,
    private readonly integrations: IntegrationService,
    private readonly mapping: MappingService,
    private readonly ledger: InventoryLedgerService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async receive(kind: ErpFeedKind, items: unknown[]): Promise<void> {
    const slug = process.env.ERP_INTEGRATION_SLUG?.trim() || 'erp';
    const integration = await this.integrations.resolve(slug);
    if (!integration) {
      // 503 so the ERP retries instead of us silently dropping the feed.
      throw new ServiceUnavailableException(`ERP integration "${slug}" is not configured`);
    }

    for (const item of items) {
      const record = await this.ingest.stage(integration.id, ENTITY_TYPE[kind], item);
      if (record.status === 'failed') continue; // parse error — kept with raw payload for inspection
      try {
        await this.process(kind, integration.id, record);
      } catch (error) {
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
        await this.dataSource.getRepository(ErpIngestRecord).save(record);
        this.logger.error(`ERP ${kind} ${record.externalId} failed: ${record.error}`);
      }
    }
  }

  private async process(kind: ErpFeedKind, integrationId: string, record: ErpIngestRecord): Promise<void> {
    const parsed = record.parsedPayload as unknown as { sku: string };
    const product = await this.ensureProduct(integrationId, parsed.sku);
    const receivedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      const base = { sku: parsed.sku, ingestRecordId: record.id, erp: record.rawPayload };
      let event;

      if (kind === 'qty') {
        const qty = parsed as ParsedFeedQty;
        const occurredAt = qty.changedAt ? new Date(qty.changedAt) : receivedAt;
        const warehouse = await this.ensureWarehouse(manager, qty.warehouseCode);
        const res = await this.ledger.recordExternalQuantity(manager, {
          productId: product.id, warehouse, source: 'erp', quantity: qty.quantity,
          reason: qty.reason, occurredAt, ref: record.id,
        });
        if (res.status !== 'applied') {
          // stale (older than what we have) or ignored (warehouse owned by us):
          // recorded in the ledger, nothing to tell the platforms.
          record.status = res.status;
          await manager.getRepository(ErpIngestRecord).save(record);
          return;
        }
        event = new InventoryQtyChanged(product.id, {
          ...base, source: 'erp', changedAt: occurredAt.toISOString(), warehouseCode: warehouse.code,
          quantity: Math.max(0, Math.floor(qty.quantity)), previousQuantity: res.previousQuantity, reason: qty.reason,
        });
      } else if (kind === 'price') {
        const price = parsed as ParsedFeedPrice;
        event = new ProductPriceChanged(product.id, {
          ...base, changedAt: receivedAt.toISOString(),
          orderingPrice: price.orderingPrice, sellingUnitPrice: price.sellingUnitPrice,
        });
      } else {
        const moq = parsed as ParsedFeedMoq;
        event = new ProductMoqChanged(product.id, { ...base, changedAt: receivedAt.toISOString(), moq: moq.moq });
      }

      await this.eventBus.publish(event, manager);
      record.status = 'applied';
      record.appliedAt = receivedAt;
      record.error = null;
      await manager.getRepository(ErpIngestRecord).save(record);
    });
  }

  /**
   * The catalog belongs to each platform; the hub only needs a product row to
   * key stock and mappings on. Unknown SKUs get a placeholder named after the
   * SKU, filled in later by the product feed (Task 3).
   */
  private async ensureProduct(integrationId: string, sku: string): Promise<Product> {
    const repo = this.dataSource.getRepository(Product);
    const mappedId = await this.mapping.toPlatformId(integrationId, 'product', sku);
    let product = mappedId ? await repo.findOne({ where: { id: mappedId } }) : null;
    product ??= await repo.findOne({ where: { sku } });
    if (!product) {
      try {
        product = await repo.save(repo.create({ sku, name: sku }));
      } catch (error) {
        // Lost a race on UQ_products_org_sku — the other request created it.
        product = await repo.findOne({ where: { sku } });
        if (!product) throw error;
      }
    }
    if (!mappedId) await this.mapping.link(integrationId, 'product', product.id, sku);
    return product;
  }

  private async ensureWarehouse(manager: EntityManager, code: string | null): Promise<Warehouse> {
    const repo = manager.getRepository(Warehouse);
    const wanted = code ?? (process.env.ERP_DEFAULT_WAREHOUSE_CODE?.trim() || 'MAIN');
    // ponytail: no unique index on warehouses.code — first-seen wins; add one if
    // more than one writer can create warehouses concurrently.
    const existing = await repo.findOne({ where: { code: wanted }, order: { createdAt: 'ASC' } });
    return existing ?? repo.save(repo.create({ code: wanted, name: wanted }));
  }
}
