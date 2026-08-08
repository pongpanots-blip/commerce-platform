import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration } from '../modules/integration/integration/infrastructure/integration.entity';
import { WebhookEvent } from '../modules/integration/webhook/infrastructure/webhook-event.entity';
import { SyncJob } from '../modules/integration/sync-job/infrastructure/sync-job.entity';
import { OutboxMessage } from '../shared-kernel/infrastructure/outbox.entity';
import { Customer } from '../modules/commerce/customer/infrastructure/customer.entity';
import { Product } from '../modules/commerce/product/infrastructure/product.entity';
import { InventoryLevel } from '../modules/commerce/inventory/infrastructure/inventory-level.entity';
import { ErpIngestRecord, ErpIngestEntityType, ErpIngestStatus } from '../modules/integration/connector/erp/erp-ingest-record.entity';
import { ErpIngestService } from '../modules/integration/connector/erp/ingest/erp-ingest.service';
import { Paginated } from '../shared-kernel/interfaces/repository.interface';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface ListErpIngestQuery {
  entityType?: ErpIngestEntityType;
  status?: ErpIngestStatus;
  page?: number;
  pageSize?: number;
}

export interface AdminStats {
  integrations: number;
  webhooksPending: number;
  webhooksFailed: number;
  outboxBacklog: number;
  syncJobsRecent: number;
  customers: number;
  products: number;
  inventoryLevels: number;
}

/**
 * App-level dashboard aggregator (a BFF concern that legitimately reads across
 * scopes). Lives outside modules/ so it is not a domain module.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
    @InjectRepository(WebhookEvent) private readonly webhooks: Repository<WebhookEvent>,
    @InjectRepository(SyncJob) private readonly syncJobs: Repository<SyncJob>,
    @InjectRepository(OutboxMessage) private readonly outbox: Repository<OutboxMessage>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(InventoryLevel) private readonly inventory: Repository<InventoryLevel>,
    @InjectRepository(ErpIngestRecord) private readonly erpIngest: Repository<ErpIngestRecord>,
    private readonly erpIngestService: ErpIngestService,
  ) {}

  async stats(): Promise<AdminStats> {
    const [
      integrations,
      webhooksPending,
      webhooksFailed,
      outboxBacklog,
      syncJobsRecent,
      customers,
      products,
      inventoryLevels,
    ] = await Promise.all([
      this.integrations.count(),
      this.webhooks.count({ where: { status: 'received' } }),
      this.webhooks.count({ where: { status: 'failed' } }),
      this.outbox.count({ where: { status: 'pending' } }),
      this.syncJobs.count(),
      this.customers.count(),
      this.products.count(),
      this.inventory.count(),
    ]);
    return {
      integrations, webhooksPending, webhooksFailed, outboxBacklog,
      syncJobsRecent, customers, products, inventoryLevels,
    };
  }

  /**
   * Paginated review list for staged ERP rows (createdAt DESC, optional
   * entityType/status filters). pageSize is clamped to MAX_PAGE_SIZE so a
   * caller can't force an unbounded scan of erp_ingest_records.
   */
  async listErpIngest(query: ListErpIngestQuery): Promise<Paginated<ErpIngestRecord>> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = Math.min(query.pageSize && query.pageSize > 0 ? query.pageSize : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const where: Record<string, unknown> = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.status) where.status = query.status;

    const [items, total] = await this.erpIngest.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  /**
   * Applies (or retries) one staged ERP row. Delegates to
   * ErpIngestService.apply, which is idempotent per record: it accepts
   * 'received' and 'failed' rows (retry), no-ops on 'applied'/'skipped'.
   */
  applyErpIngest(id: string): Promise<ErpIngestRecord> {
    return this.erpIngestService.apply(id);
  }
}
