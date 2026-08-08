import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ErpIngestEntityType, ErpIngestRecord } from '../erp-ingest-record.entity';
import {
  ParsedCustomer, ParsedProduct, ParsedStock,
  parseErpCustomer, parseErpProduct, parseErpSaleOrder, parseErpStock,
} from './erp-payload.parsers';
import { SettingsService } from '../../../../core/settings/application/settings.service';
import { MappingService } from '../../../mapping/application/mapping.service';
import { Product } from '../../../../commerce/product/infrastructure/product.entity';
import { PriceList } from '../../../../commerce/price-list/infrastructure/price-list.entity';
import { PriceListItem } from '../../../../commerce/price-list/infrastructure/price-list-item.entity';
import { Warehouse } from '../../../../commerce/warehouse/infrastructure/warehouse.entity';
import { InventoryLevel } from '../../../../commerce/inventory/infrastructure/inventory-level.entity';
import { Customer } from '../../../../commerce/customer/infrastructure/customer.entity';

const PARSERS: Record<ErpIngestEntityType, (raw: unknown) => Record<string, unknown>> = {
  product: parseErpProduct as never, stock: parseErpStock as never,
  customer: parseErpCustomer as never, sale_order: parseErpSaleOrder as never,
};
const EXTERNAL_ID_KEYS: Record<ErpIngestEntityType, string> = {
  product: 'externalId', stock: 'externalItemId', customer: 'externalId', sale_order: 'orderNumber',
};

const ERP_BASE_PRICE_LIST_NAME = 'ERP Base';
const DEFAULT_AUTO_APPLY: ErpIngestEntityType[] = ['product', 'stock', 'customer'];

/**
 * Stages inbound ERP payloads verbatim ("เอามากรองก่อน"): parses via the
 * anti-corruption layer (erp-payload.parsers.ts) and writes one
 * ErpIngestRecord per payload, never throwing — parse failures land as
 * `status: 'failed'` rows with the raw payload preserved for retry/inspection.
 *
 * `apply()` reads a single staged row and writes platform tables, entity by
 * entity, honoring field ownership so ERP sync never clobbers platform-owned
 * data (e.g. product merchandising copy). `stageAndApply()` chains the two
 * per an admin-configurable auto-apply policy.
 */
@Injectable()
export class ErpIngestService {
  private readonly logger = new Logger(ErpIngestService.name);

  private readonly appliers: Record<'product' | 'stock' | 'customer', (record: ErpIngestRecord) => Promise<void>> = {
    product: (record) => this.applyProduct(record),
    stock: (record) => this.applyStock(record),
    customer: (record) => this.applyCustomer(record),
  };

  constructor(
    @InjectRepository(ErpIngestRecord) private readonly repo: Repository<ErpIngestRecord>,
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly mapping: MappingService,
  ) {}

  async stage(integrationId: string, entityType: ErpIngestEntityType, raw: unknown): Promise<ErpIngestRecord> {
    try {
      const parsed = PARSERS[entityType](raw);
      return await this.repo.save(this.repo.create({
        integrationId, entityType, rawPayload: raw, parsedPayload: parsed,
        externalId: String(parsed[EXTERNAL_ID_KEYS[entityType]] ?? '') || null,
        status: 'received',
      }));
    } catch (error) {
      this.logger.warn(`ERP ${entityType} payload failed to parse: ${error}`);
      return await this.repo.save(this.repo.create({
        integrationId, entityType, rawPayload: raw, parsedPayload: null,
        externalId: null, status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /**
   * Applies ONE staged row to the platform tables. Only `received` or
   * `failed` rows are eligible (retries re-run a previously failed apply);
   * `applied`/`skipped` rows are a no-op — apply() is idempotent per record.
   *
   * A row can be `failed` with `parsedPayload: null` (it never made it past
   * stage()'s parser). Retrying such a row re-runs the SAME parser (see
   * PARSERS map) against the preserved rawPayload first: if it still throws,
   * the row stays 'failed' with the parser's error message — it must NOT
   * fall through to the sale_order 'skipped' branch or to an applier that
   * would crash on a null payload, either of which would erase the original,
   * informative parse error. If the parser now succeeds (e.g. the payload
   * was fixed, or the parser itself was patched), the row gets a real
   * parsedPayload/externalId and proceeds to the normal apply path below.
   *
   * sale_order is handled specially: it is store-only by design this cycle
   * (see class doc on the deviation) — no platform writes, no mapping call,
   * status goes straight to 'skipped'. Every other entity type runs its
   * applier; success -> 'applied' + appliedAt, any thrown error -> 'failed'
   * with the error message (never propagates to the caller).
   */
  async apply(recordId: string): Promise<ErpIngestRecord> {
    const record = await this.repo.findOne({ where: { id: recordId } });
    if (!record) throw new Error(`ErpIngestRecord ${recordId} not found`);
    if (record.status !== 'received' && record.status !== 'failed') return record;

    if (record.parsedPayload == null) {
      try {
        const parsed = PARSERS[record.entityType](record.rawPayload);
        record.parsedPayload = parsed;
        record.externalId = String(parsed[EXTERNAL_ID_KEYS[record.entityType]] ?? '') || null;
      } catch (error) {
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
        return this.repo.save(record);
      }
    }

    try {
      if (record.entityType === 'sale_order') {
        // Store-only by design this cycle (T9 binding rule, supersedes spec
        // §5's order_mappings mention): an ERP-originated sale order has no
        // platform Order created for it yet, so there is no platform id to
        // hand MappingService.link and nothing to write. The row stays
        // staging-only, marked 'skipped' so it's visibly processed without
        // pretending it became a platform entity.
        record.status = 'skipped';
      } else {
        await this.appliers[record.entityType](record);
        record.status = 'applied';
        record.appliedAt = new Date();
      }
      record.error = null;
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
    }
    return this.repo.save(record);
  }

  /** stage() then apply() per the auto-apply policy (settings-driven, org-level default). */
  async stageAndApply(integrationId: string, entityType: ErpIngestEntityType, raw: unknown): Promise<ErpIngestRecord> {
    const record = await this.stage(integrationId, entityType, raw);
    if (record.status !== 'received') return record;

    const auto = (await this.settings.get<string[]>('integration', 'erp_auto_apply')) ?? DEFAULT_AUTO_APPLY;
    if (auto.includes(entityType) || entityType === 'sale_order') {
      // sale_order always runs so it lands 'skipped' immediately, regardless
      // of the auto-apply list — there's no meaningful "received, unapplied"
      // state for a store-only entity type.
      return this.apply(record.id);
    }
    return record;
  }

  private async resolveProductByMapping(integrationId: string, externalId: string | null): Promise<Product | null> {
    if (!externalId) return null;
    const platformId = await this.mapping.toPlatformId(integrationId, 'product', externalId);
    if (!platformId) return null;
    return this.dataSource.getRepository(Product).findOne({ where: { id: platformId } });
  }

  private async findOrCreateErpPriceList(): Promise<PriceList> {
    const repo = this.dataSource.getRepository(PriceList);
    const existing = await repo.findOne({ where: { name: ERP_BASE_PRICE_LIST_NAME } });
    if (existing) return existing;
    return repo.save(repo.create({ name: ERP_BASE_PRICE_LIST_NAME, currency: 'THB', status: 'active' }));
  }

  private async applyProduct(record: ErpIngestRecord): Promise<void> {
    const parsed = record.parsedPayload as unknown as ParsedProduct;
    const productRepo = this.dataSource.getRepository(Product);

    let product = await this.resolveProductByMapping(record.integrationId, record.externalId);
    if (!product) product = await productRepo.findOne({ where: { sku: parsed.sku } });

    if (product) {
      // Field ownership: ERP is the source of truth for status/leadTimeDays
      // on a synced SKU, but NEVER for `name` — merchandising copy is
      // platform-owned (see docs/... Flow 1 field-ownership note); ERP sync
      // overwriting it would silently clobber a human catalog edit.
      product.status = parsed.status;
      product.leadTimeDays = parsed.leadTimeDays;
      product = await productRepo.save(product);
    } else {
      product = await productRepo.save(productRepo.create({
        sku: parsed.sku, name: parsed.name, status: parsed.status, leadTimeDays: parsed.leadTimeDays,
      }));
    }

    if (parsed.listPrice !== null) {
      const priceList = await this.findOrCreateErpPriceList();
      const priceListItemRepo = this.dataSource.getRepository(PriceListItem);
      // Append-only price history, but only for REAL changes: every
      // product.changed webhook (and every failed-then-retried apply) reaches
      // this point, and the (priceListId, productId) index is non-unique — so
      // without this guard, unchanged prices would pile up duplicate rows.
      const latest = await priceListItemRepo.findOne({
        where: { priceListId: priceList.id, productId: product.id, minQty: '1' },
        order: { createdAt: 'DESC' },
      });
      const unchanged = latest && Number(latest.unitPrice).toFixed(2) === parsed.listPrice;
      if (!unchanged) {
        await priceListItemRepo.save(priceListItemRepo.create({
          priceListId: priceList.id, productId: product.id, unitPrice: parsed.listPrice,
        }));
      }
    }

    if (record.externalId) {
      await this.mapping.link(record.integrationId, 'product', product.id, record.externalId);
    }
  }

  private async applyStock(record: ErpIngestRecord): Promise<void> {
    const parsed = record.parsedPayload as unknown as ParsedStock;
    const productRepo = this.dataSource.getRepository(Product);
    const warehouseRepo = this.dataSource.getRepository(Warehouse);
    const inventoryRepo = this.dataSource.getRepository(InventoryLevel);

    let product = await this.resolveProductByMapping(record.integrationId, parsed.externalItemId);
    if (!product && parsed.sku) product = await productRepo.findOne({ where: { sku: parsed.sku } });
    if (!product) throw new Error('unknown product');

    let warehouse = await warehouseRepo.findOne({ where: { code: parsed.warehouseCode } });
    if (!warehouse) {
      warehouse = await warehouseRepo.save(
        warehouseRepo.create({ code: parsed.warehouseCode, name: parsed.warehouseCode }),
      );
    }

    const existingLevel = await inventoryRepo.findOne({ where: { productId: product.id, warehouseId: warehouse.id } });
    const level = existingLevel
      ? Object.assign(existingLevel, { quantity: String(parsed.quantity) })
      : inventoryRepo.create({ productId: product.id, warehouseId: warehouse.id, quantity: String(parsed.quantity) });
    await inventoryRepo.save(level);
  }

  private async applyCustomer(record: ErpIngestRecord): Promise<void> {
    const parsed = record.parsedPayload as unknown as ParsedCustomer;
    const customerRepo = this.dataSource.getRepository(Customer);

    let customer = await customerRepo.findOne({ where: { code: parsed.code } });
    if (!customer && parsed.email) customer = await customerRepo.findOne({ where: { email: parsed.email } });
    if (!customer && parsed.phone) customer = await customerRepo.findOne({ where: { phone: parsed.phone } });

    if (customer) {
      customer.name = parsed.name;
      customer.code = parsed.code; // ERP owns the account code
      customer.email = customer.email ?? parsed.email; // fill-only: don't clobber a platform-entered value
      customer.phone = customer.phone ?? parsed.phone;
      customer = await customerRepo.save(customer);
    } else {
      customer = await customerRepo.save(customerRepo.create({
        code: parsed.code, name: parsed.name, email: parsed.email, phone: parsed.phone,
      }));
    }

    if (record.externalId) {
      await this.mapping.link(record.integrationId, 'customer', customer.id, record.externalId);
    }
  }
}
