import { NotFoundException } from '@nestjs/common';
import {
  IRepository,
  FindManyParams,
  Paginated,
} from '../interfaces/repository.interface';

/**
 * Generic CRUD service over the repository port. Concrete services extend this
 * (supplying `entityName` for error messages) and add domain behaviour —
 * e.g. emitting events — by overriding `create`/`update`.
 */
export abstract class BaseCrudService<T extends { id: string }> {
  protected constructor(protected readonly repo: IRepository<T>) {}

  create(dto: Partial<T>): Promise<T> {
    return this.repo.save(dto);
  }

  findMany(params: FindManyParams): Promise<Paginated<T>> {
    return this.repo.findMany(params);
  }

  async findOne(id: string): Promise<T> {
    const found = await this.repo.findById(id);
    if (!found) {
      throw new NotFoundException(`${this.entityName} ${id} not found`);
    }
    return found;
  }

  async update(id: string, dto: Partial<T>): Promise<T> {
    const current = await this.findOne(id);
    return this.repo.save({ ...current, ...dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repo.softDelete(id);
  }

  protected abstract get entityName(): string;
}
