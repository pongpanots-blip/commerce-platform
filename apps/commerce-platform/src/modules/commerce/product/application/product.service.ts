import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { BaseCrudService } from '../../../../shared-kernel/application/base-crud.service';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { Product } from '../infrastructure/product.entity';
import { ProductRepository } from '../infrastructure/product.repository';
import { ProductUpdated } from '../domain/events/product-updated.event';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as unknown as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

/** Product CRUD. Duplicate SKU -> 409; update emits product.updated. */
@Injectable()
export class ProductService extends BaseCrudService<Product> {
  protected override readonly searchFields = ['sku', 'name'];

  constructor(
    repo: ProductRepository,
    private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {
    super(repo);
  }

  protected get entityName(): string {
    return 'Product';
  }

  override async create(dto: Partial<Product>): Promise<Product> {
    try {
      return await super.create(dto);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Product SKU "${dto.sku}" already exists`);
      }
      throw error;
    }
  }

  override async update(id: string, dto: Partial<Product>): Promise<Product> {
    const current = await this.findOne(id);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Product);
        const saved = await repo.save({ ...current, ...dto });
        await this.eventBus.publish(new ProductUpdated(saved.id, { id: saved.id }), manager);
        return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Product SKU "${dto.sku}" already exists`);
      }
      throw error;
    }
  }
}
