import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseCrudService } from '../../../../shared-kernel/application/base-crud.service';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { Customer } from '../infrastructure/customer.entity';
import { CustomerRepository } from '../infrastructure/customer.repository';
import { CustomerCreated } from '../domain/events/customer-created.event';
import { CustomerUpdated } from '../domain/events/customer-updated.event';

/**
 * Customer CRUD. Overrides create/update to persist the row and publish the
 * domain event in the SAME transaction (via the outbox), so the write and the
 * event commit atomically.
 */
@Injectable()
export class CustomerService extends BaseCrudService<Customer> {
  constructor(
    repo: CustomerRepository,
    private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {
    super(repo);
  }

  protected get entityName(): string {
    return 'Customer';
  }

  override async create(dto: Partial<Customer>): Promise<Customer> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Customer);
      const saved = await repo.save(repo.create(dto));
      await this.eventBus.publish(new CustomerCreated(saved.id, { id: saved.id }), manager);
      return saved;
    });
  }

  override async update(id: string, dto: Partial<Customer>): Promise<Customer> {
    const current = await this.findOne(id);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Customer);
      const saved = await repo.save({ ...current, ...dto });
      await this.eventBus.publish(new CustomerUpdated(saved.id, { id: saved.id }), manager);
      return saved;
    });
  }
}
