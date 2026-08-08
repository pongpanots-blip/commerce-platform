import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExternalMappingBase } from '../infrastructure/external-mapping.base';
import { CustomerMapping } from '../infrastructure/customer-mapping.entity';
import { ProductMapping } from '../infrastructure/product-mapping.entity';
import { OrderMapping } from '../infrastructure/order-mapping.entity';
import { InventoryMapping } from '../infrastructure/inventory-mapping.entity';
import { SupplierMapping } from '../infrastructure/supplier-mapping.entity';

export type MappingEntityType =
  | 'customer'
  | 'product'
  | 'order'
  | 'inventory'
  | 'supplier';

/**
 * Bidirectional bridge between canonical platform UUIDs and external (ERP) IDs.
 * The ONLY component that resolves external identities — connectors and the
 * webhook worker go through here rather than embedding external IDs anywhere.
 */
@Injectable()
export class MappingService {
  private readonly logger = new Logger(MappingService.name);
  private readonly repos: Record<MappingEntityType, Repository<ExternalMappingBase>>;

  constructor(
    @InjectRepository(CustomerMapping) customer: Repository<CustomerMapping>,
    @InjectRepository(ProductMapping) product: Repository<ProductMapping>,
    @InjectRepository(OrderMapping) order: Repository<OrderMapping>,
    @InjectRepository(InventoryMapping) inventory: Repository<InventoryMapping>,
    @InjectRepository(SupplierMapping) supplier: Repository<SupplierMapping>,
  ) {
    this.repos = {
      customer: customer as Repository<ExternalMappingBase>,
      product: product as Repository<ExternalMappingBase>,
      order: order as Repository<ExternalMappingBase>,
      inventory: inventory as Repository<ExternalMappingBase>,
      supplier: supplier as Repository<ExternalMappingBase>,
    };
  }

  private repo(entityType: MappingEntityType): Repository<ExternalMappingBase> {
    return this.repos[entityType];
  }

  async toPlatformId(
    integrationId: string,
    entityType: MappingEntityType,
    externalId: string,
  ): Promise<string | null> {
    const row = await this.repo(entityType).findOne({
      where: { integrationId, externalId },
    });
    return row?.platformId ?? null;
  }

  async toExternalId(
    integrationId: string,
    entityType: MappingEntityType,
    platformId: string,
  ): Promise<string | null> {
    const row = await this.repo(entityType).findOne({
      where: { integrationId, platformId },
    });
    return row?.externalId ?? null;
  }

  /**
   * Upsert by (integrationId, platformId), never-throw / never-auto-merge.
   * Every mapping table is unique on BOTH (integrationId, platformId) and
   * (integrationId, externalId), so:
   *   - re-linking the same platform entity (returning customer syncing to
   *     the ERP again) updates its existing row — a blind insert 500s;
   *   - if the externalId is already owned by a DIFFERENT platform entity,
   *     we do NOT write at all (warn and keep the existing rows untouched).
   *     Repointing it would be an auto-merge, which the identity-resolution
   *     design forbids: deterministic only, conflicts surface for humans.
   */
  async link(
    integrationId: string,
    entityType: MappingEntityType,
    platformId: string,
    externalId: string,
    externalRef: Record<string, unknown> | null = null,
  ): Promise<void> {
    const repo = this.repo(entityType);
    const existing = await repo.findOne({ where: { integrationId, platformId } });

    const conflict = await repo.findOne({ where: { integrationId, externalId } });
    if (conflict && conflict.platformId !== platformId) {
      this.logger.warn(
        `mapping conflict: ${entityType} externalId ${externalId} already linked to platform ` +
          `${conflict.platformId} (integration ${integrationId}) — skipping link for platform ${platformId}`,
      );
      return;
    }

    await repo.save(
      existing
        ? repo.create({ ...existing, externalId, externalRef })
        : repo.create({ integrationId, platformId, externalId, externalRef }),
    );
  }
}
