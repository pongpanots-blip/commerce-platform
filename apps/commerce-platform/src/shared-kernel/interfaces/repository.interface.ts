/**
 * Persistence-agnostic repository port. Application services depend on this
 * interface (never on TypeORM's `Repository<T>` directly), keeping persistence
 * swappable and unit-testable.
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FindManyParams {
  page?: number;
  pageSize?: number;
  where?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  /** Case-insensitive substring match: a row matches when any of `fields` contains `term`. */
  search?: { term: string; fields: string[] };
}

export interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  findMany(params: FindManyParams): Promise<Paginated<T>>;
  save(entity: Partial<T>): Promise<T>;
  softDelete(id: string): Promise<void>;
}
