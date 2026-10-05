import { Injectable } from '@nestjs/common';
import { JoshReplica } from '../../../integration/connector/josh/josh-replica';

export type CuisineHierarchyItem = {
  id: string;
  parent_id: string | null;
  cuisine_name: string;
  cuisine_name_th?: string | null;
  level: number;
};

const RESTAURANT_CUISINE_CATALOG_SQL = `
  SELECT c.id, c.parent_id, c.cuisine_name, c.cuisine_name_th, c.level
  FROM cuisine c
  WHERE c.is_active = TRUE
    AND c.level IN (1, 2)
    AND (
      c.parent_id = (
        SELECT root.id
        FROM cuisine root
        WHERE root.level = 0
          AND root.cuisine_name = 'Restaurant'
          AND root.is_active = TRUE
        LIMIT 1
      )
      OR c.parent_id IN (
        SELECT parent.id
        FROM cuisine parent
        WHERE parent.level = 1
          AND parent.is_active = TRUE
          AND parent.parent_id = (
            SELECT root.id
            FROM cuisine root
            WHERE root.level = 0
              AND root.cuisine_name = 'Restaurant'
              AND root.is_active = TRUE
            LIMIT 1
          )
      )
    )
  ORDER BY c.level ASC, c.cuisine_name ASC
`;

const CACHE_MS = 10 * 60_000;

/**
 * josh CuisineService.findCuisineHierarchy for the intake form's cuisine dropdown: the same queries
 * (josh `cuisine.service.ts` queryCatalogFromDb, copied) on josh's replica — cuisine stays a josh
 * storefront table. Cached 10 minutes in memory (josh caches in Redis).
 */
@Injectable()
export class CuisineService {
  private readonly cache = new Map<string, { at: number; rows: CuisineHierarchyItem[] }>();

  constructor(private readonly replica: JoshReplica) {}

  async findCuisineHierarchy(filters?: { parent_id?: string; level?: number }): Promise<CuisineHierarchyItem[]> {
    const key = `${filters?.parent_id ?? ''}:${filters?.level ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
    const rows = await this.queryCatalogFromDb(filters);
    this.cache.set(key, { at: Date.now(), rows });
    return rows;
  }

  private async queryCatalogFromDb(filters?: {
    parent_id?: string;
    level?: number;
  }): Promise<CuisineHierarchyItem[]> {
    if (filters?.parent_id) {
      return (await this.replica.query(
        `SELECT c.id, c.parent_id, c.cuisine_name, c.cuisine_name_th, c.level
         FROM cuisine c
         WHERE c.is_active = TRUE
           AND c.level = 2
           AND c.parent_id = $1
         ORDER BY c.cuisine_name ASC`,
        [filters.parent_id],
      )) as CuisineHierarchyItem[];
    }

    if (filters?.level === 1) {
      return (await this.replica.query(
        `SELECT c.id, c.parent_id, c.cuisine_name, c.cuisine_name_th, c.level
         FROM cuisine c
         WHERE c.is_active = TRUE
           AND c.level = 1
           AND c.parent_id = (
             SELECT root.id
             FROM cuisine root
             WHERE root.level = 0
               AND root.cuisine_name = 'Restaurant'
               AND root.is_active = TRUE
             LIMIT 1
           )
         ORDER BY c.cuisine_name ASC`,
      )) as CuisineHierarchyItem[];
    }

    if (filters?.level === 2) {
      return (await this.replica.query(
        `SELECT c.id, c.parent_id, c.cuisine_name, c.cuisine_name_th, c.level
         FROM cuisine c
         WHERE c.is_active = TRUE
           AND c.level = 2
           AND c.parent_id IN (
             SELECT parent.id
             FROM cuisine parent
             WHERE parent.level = 1
               AND parent.is_active = TRUE
               AND parent.parent_id = (
                 SELECT root.id
                 FROM cuisine root
                 WHERE root.level = 0
                   AND root.cuisine_name = 'Restaurant'
                   AND root.is_active = TRUE
                 LIMIT 1
               )
           )
         ORDER BY c.cuisine_name ASC`,
      )) as CuisineHierarchyItem[];
    }

    return (await this.replica.query(
      RESTAURANT_CUISINE_CATALOG_SQL,
    )) as CuisineHierarchyItem[];
  }
}
