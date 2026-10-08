import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';

/**
 * Opt-in paging for the commerce product queues (prices, MER queues, supplier order rounds). With `page` or `limit` the
 * route answers `{ items, total, page, limit }` (default 20, max 100); with neither it keeps the bare array and its old cap.
 */
export class QueuePageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export interface QueuePage { page: number; limit: number }
export interface Paged<T> { items: T[]; total: number; page: number; limit: number }

export const queuePage = (q?: QueuePageQuery): QueuePage | undefined =>
  q?.page == null && q?.limit == null ? undefined : { page: q.page ?? 1, limit: q.limit ?? 20 };

/** `SELECT <select> FROM <from> ORDER BY <order>` — `from` carries the joins and the WHERE, over `params`. */
export interface QueueSql { select: string; from: string; order: string }

export function queueList<T>(db: DataSource, sql: QueueSql, params: unknown[], paging: QueuePage, cap: number): Promise<Paged<T>>;
export function queueList<T>(db: DataSource, sql: QueueSql, params: unknown[], paging: QueuePage | undefined, cap: number): Promise<T[] | Paged<T>>;
export async function queueList<T>(db: DataSource, sql: QueueSql, params: unknown[], paging: QueuePage | undefined, cap: number): Promise<T[] | Paged<T>> {
  const base = `SELECT ${sql.select} FROM ${sql.from} ORDER BY ${sql.order}`;
  if (!paging) return db.query(`${base} LIMIT ${cap}`, params);
  const { page, limit } = paging;
  const n = params.length;
  const [items, [{ total }]] = await Promise.all([
    db.query(`${base} LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, (page - 1) * limit]),
    db.query(`SELECT count(*)::int AS total FROM ${sql.from}`, params),
  ]);
  return { items, total, page, limit };
}
