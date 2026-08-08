import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseCrudService } from '../../../../shared-kernel/application/base-crud.service';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { InventoryRepository } from '../infrastructure/inventory.repository';
import { InventoryUpdated } from '../domain/events/inventory-updated.event';

/**
 * Inventory CRUD. Publishes inventory.updated on create and whenever `quantity`
 * or `reserved` actually changes on update (not for unrelated field edits).
 */
@Injectable()
export class InventoryService extends BaseCrudService<InventoryLevel> {
  constructor(
    repo: InventoryRepository,
    private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {
    super(repo);
  }

  protected get entityName(): string {
    return 'InventoryLevel';
  }

  override async create(dto: Partial<InventoryLevel>): Promise<InventoryLevel> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(InventoryLevel);
      const saved = await repo.save(repo.create(dto));
      await this.publishUpdated(saved, manager);
      return saved;
    });
  }

  override async update(id: string, dto: Partial<InventoryLevel>): Promise<InventoryLevel> {
    const current = await this.findOne(id);
    const quantityChanged = dto.quantity !== undefined && dto.quantity !== current.quantity;
    const reservedChanged = dto.reserved !== undefined && dto.reserved !== current.reserved;

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(InventoryLevel);
      const saved = await repo.save({ ...current, ...dto });
      if (quantityChanged || reservedChanged) {
        await this.publishUpdated(saved, manager);
      }
      return saved;
    });
  }

  private publishUpdated(row: InventoryLevel, manager: EntityManager): Promise<void> {
    return this.eventBus.publish(
      new InventoryUpdated(row.id, {
        id: row.id,
        quantity: Number(row.quantity),
        reserved: Number(row.reserved),
      }),
      manager,
    );
  }
}
