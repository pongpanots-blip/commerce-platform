import { Repository, ObjectLiteral } from 'typeorm';
import {
  IRepository,
  FindManyParams,
  Paginated,
} from '../interfaces/repository.interface';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Generic TypeORM-backed implementation of the repository port. Concrete
 * repositories extend this and inject their entity's `Repository<T>`.
 */
export abstract class TypeOrmBaseRepository<T extends ObjectLiteral>
  implements IRepository<T>
{
  protected constructor(protected readonly repo: Repository<T>) {}

  findById(id: string): Promise<T | null> {
    return this.repo.findOne({ where: { id } as never });
  }

  async findMany(params: FindManyParams): Promise<Paginated<T>> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = Math.min(params.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const [items, total] = await this.repo.findAndCount({
      where: params.where as never,
      order: params.order as never,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  save(entity: Partial<T>): Promise<T> {
    return this.repo.save(entity as never) as unknown as Promise<T>;
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }
}
