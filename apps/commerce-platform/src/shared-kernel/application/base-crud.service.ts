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
  /** Columns the list endpoint's `search` matches against. Empty = search is ignored. */
  protected readonly searchFields: string[] = [];

  protected constructor(protected readonly repo: IRepository<T>) {}

  create(dto: Partial<T>): Promise<T> {
    return this.repo.save(dto);
  }

  findMany(params: FindManyParams): Promise<Paginated<T>> {
    return this.repo.findMany(params);
  }

  /** Admin list: newest first, optionally narrowed by a free-text search over `searchFields`. */
  list(query: { page?: number; pageSize?: number; search?: string }): Promise<Paginated<T>> {
    const term = query.search?.trim();
    return this.repo.findMany({
      page: query.page,
      pageSize: query.pageSize,
      order: { createdAt: 'DESC', id: 'DESC' },
      search: term ? { term, fields: this.searchFields } : undefined,
    });
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
