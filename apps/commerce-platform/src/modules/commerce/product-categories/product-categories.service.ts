import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { BrandSnapshot, CategoryTreeSnapshot } from './category-tree.events';
import { CATEGORY_COLUMNS, CategoryRow, normalizeSortOptions, presentCategory, toCatCode, toTitleCase, toTitleCasePath } from './category-rules';
import type { CreateCategoryDto, UpdateBrandDto, UpdateCategoryDto } from './product-categories.dto';

export const ownsCategories = () => process.env.COMMERCE_OWNS_CATEGORIES === 'true';

/** Same SQL as josh's rebuildSubtree: level / code / path / path_code of a category and all its descendants from sort + names. */
const REBUILD_SUBTREE = `WITH RECURSIVE seed AS (
    SELECT c.id, COALESCE(p.level, -1) + 1 AS level,
      CASE WHEN p.id IS NULL THEN COALESCE(c.sort, 0)::text ELSE p.category_code || '-' || COALESCE(c.sort, 0)::text END AS code,
      CASE WHEN p.id IS NULL THEN c.category_name_en ELSE p.category_path || ' > ' || c.category_name_en END AS path,
      CASE WHEN p.id IS NULL THEN COALESCE(c.sort, 0)::text
           ELSE p.category_path_code || ' > ' || p.category_code || '-' || COALESCE(c.sort, 0)::text END AS path_code
    FROM product_categories c LEFT JOIN product_categories p ON p.id = c.parent_id WHERE c.id = $1
  ), tree AS (
    SELECT * FROM seed
    UNION ALL
    SELECT c.id, t.level + 1, t.code || '-' || COALESCE(c.sort, 0)::text, t.path || ' > ' || c.category_name_en,
      t.path_code || ' > ' || t.code || '-' || COALESCE(c.sort, 0)::text
    FROM product_categories c JOIN tree t ON c.parent_id = t.id
  )
  UPDATE product_categories pc SET level = tree.level, category_code = tree.code, category_path = tree.path,
    category_path_code = tree.path_code, updated_at = now()
  FROM tree WHERE pc.id = tree.id`;

/** Park the codes of these categories and their descendants (category_code is unique, not deferrable) before a rebuild. */
const PARK_BRANCH_CODES = `WITH RECURSIVE branch AS (
    SELECT id FROM product_categories WHERE id = ANY($1::uuid[])
    UNION ALL SELECT c.id FROM product_categories c JOIN branch b ON c.parent_id = b.id
  )
  UPDATE product_categories pc SET category_code = 'tmp-' || pc.id::text FROM branch WHERE pc.id = branch.id`;

const SET_SORT = `UPDATE product_categories pc SET sort = v.position, updated_at = now()
  FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS position) v WHERE pc.id = v.id`;

/**
 * The shop's category tree and brand names, owned by commerce (stage 4c, COMMERCE_OWNS_CATEGORIES). josh's rules and
 * answers (product-category.service.ts / brand.service.ts) on commerce's copy; every category write publishes the whole
 * tree and every brand edit that brand, in the same transaction.
 */
@Injectable()
export class ProductCategoriesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  async create(dto: CreateCategoryDto) {
    return this.write(async (m) => {
      const parent = dto.parent_id ? await this.find(m, dto.parent_id) : null;
      if (dto.parent_id && !parent) throw new NotFoundException('Parent category not found');
      const nameEn = toTitleCase(dto.category_name_en);
      const level = parent ? (parent.level ?? 0) + 1 : (dto.category_level ?? 0);
      await this.assertNoDuplicateName(m, level, nameEn, dto.category_name_th);
      const catCode = toCatCode(nameEn);
      const [clash] = await m.query(`SELECT category_name_en FROM product_categories WHERE level = $1 AND cat_code = $2`, [level, catCode]);
      if (clash) {
        throw new ConflictException(`ชื่อหมวดหมู่ "${nameEn}" ชนกับ cat_code "${catCode}" ของหมวด "${clash.category_name_en}" ที่ระดับเดียวกัน`);
      }
      const sort = dto.sort_order ?? (await this.nextSortOrder(m, parent));
      const code = parent?.category_code ? `${parent.category_code}-${sort}` : String(sort);
      const parentPath = parent?.category_path ? toTitleCasePath(parent.category_path) : null;
      const [saved]: CategoryRow[] = await m.query(
        `INSERT INTO product_categories (id, parent_id, category_code, category_name_en, category_name_th, category_path, cat_code,
           category_path_code, category_image, level, sort, is_active, show_on_homepage, default_sort_key, sort_options)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [randomUUID(), parent?.id ?? null, code, nameEn, dto.category_name_th ?? null, parentPath ? `${parentPath} > ${nameEn}` : nameEn, catCode,
          parent?.category_path_code ? `${parent.category_path_code} > ${code}` : code, dto.category_image ?? null, level, sort,
          dto.is_active ?? true, dto.show_on_homepage ?? true, dto.default_sort_key ?? null, JSON.stringify(normalizeSortOptions(dto.sort_options))]);
      return { status: true, statusCode: 201, message: 'สำเร็จ', data: presentCategory(saved) };
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    return this.write(async (m) => {
      const before = await this.find(m, id);
      if (!before) throw new NotFoundException('Category not found');
      const next = { ...before };
      // parent / level are not editable (josh's UpdateCategoryDto drops them): the tree's shape comes from the seed.
      if (dto.category_name_en !== undefined) next.category_name_en = toTitleCase(dto.category_name_en);
      if (dto.category_name_th !== undefined) next.category_name_th = dto.category_name_th;
      if (dto.category_image !== undefined) next.category_image = dto.category_image;
      if (dto.sort_order !== undefined) next.sort = dto.sort_order;
      if (dto.is_active !== undefined) next.is_active = dto.is_active;
      if (dto.show_on_homepage !== undefined) next.show_on_homepage = dto.show_on_homepage;
      if (dto.default_sort_key !== undefined) next.default_sort_key = dto.default_sort_key;
      if (dto.sort_options !== undefined) next.sort_options = normalizeSortOptions(dto.sort_options);
      await this.assertNoDuplicateName(m, next.level ?? 0, next.category_name_en, next.category_name_th, id);

      await m.query(
        `UPDATE product_categories SET category_name_en = $2, category_name_th = $3, category_image = $4, sort = $5, is_active = $6,
           show_on_homepage = $7, default_sort_key = $8, sort_options = $9, updated_at = now() WHERE id = $1`,
        [id, next.category_name_en, next.category_name_th, next.category_image, next.sort, next.is_active, next.show_on_homepage,
          next.default_sort_key, JSON.stringify(next.sort_options ?? [])]);
      // Position in the tree changed → path / code / level of the whole branch.
      if (next.category_name_en !== before.category_name_en || (dto.sort_order !== undefined && dto.sort_order !== before.sort)) {
        await m.query(REBUILD_SUBTREE, [id]);
      }
      return { status: true, statusCode: 200, message: 'อัปเดตสำเร็จ', data: presentCategory((await this.find(m, id))!) };
    });
  }

  /** The whole level-1 row (it is one global order on the shop's home page) — josh's reorderLevel1Categories. */
  async reorderLevel1(orderedIds: string[]) {
    return this.write(async (m) => {
      const rows: Array<{ id: string }> = await m.query(`SELECT id FROM product_categories WHERE level = 1`);
      this.assertExactSet(rows.map((r) => r.id), orderedIds, 'หมวด Level 1', 'ไม่ใช่หมวด Level 1', 'orderedIds ต้องมีครบทุกหมวด Level 1 พอดี');
      await this.resort(m, orderedIds);
      return { status: true, statusCode: 200, message: 'จัดลำดับสำเร็จ' };
    });
  }

  /** All children of one parent (level 2+) — josh's reorderChildren. */
  async reorderChildren(parentId: string, orderedIds: string[]) {
    return this.write(async (m) => {
      const siblings: Array<{ id: string; level: number | null }> = await m.query(`SELECT id, level FROM product_categories WHERE parent_id = $1`, [parentId]);
      if (!siblings.length) throw new BadRequestException(`หมวด ${parentId} ไม่มีหมวดย่อยให้จัดลำดับ`);
      if (siblings.some((r) => r.level === 1)) {
        throw new BadRequestException('หมวด Level 1 เรียงทั้งชั้นเป็นลำดับเดียว — ใช้ PUT /product-category/level1-order แทน');
      }
      this.assertExactSet(siblings.map((r) => r.id), orderedIds, 'หมวดย่อย', 'ไม่ใช่หมวดย่อยของหมวดนี้', 'orderedIds ต้องมีครบทุกหมวดย่อยของหมวดนี้พอดี');
      await this.resort(m, orderedIds);
      return { status: true, statusCode: 200, message: 'จัดลำดับสำเร็จ' };
    });
  }

  async remove(id: string) {
    return this.write(async (m) => {
      const [, n] = await m.query(`DELETE FROM product_categories WHERE id = $1`, [id]);
      if (!n) throw new NotFoundException('Category not found');
      return { status: true, statusCode: 200, message: 'ลบสำเร็จ' };
    });
  }

  /** Brand names (josh's BrandService.update): only the names are editable. */
  async updateBrand(id: string, dto: UpdateBrandDto, staffId: string) {
    this.assertOwned();
    return this.db.transaction(async (m) => {
      const [[brand]] = await m.query(
        `UPDATE product_brands SET brand_name_th = CASE WHEN $2 THEN $3 ELSE brand_name_th END,
           brand_name_en = CASE WHEN $4 THEN $5 ELSE brand_name_en END, updated_by = $6, updated_at = now()
         WHERE id = $1 RETURNING id, brand_code, brand_name_th, brand_name_en`,
        [id, dto.brand_name_th !== undefined, dto.brand_name_th ?? null, dto.brand_name_en !== undefined, dto.brand_name_en ?? null, staffId]);
      if (!brand) throw new NotFoundException(`Brand ${id} not found`);
      await this.events.publish(new BrandSnapshot({ ...brand, version: new Date().toISOString() }), m);
      return { statusCode: 200, data: brand };
    });
  }

  private async resort(m: EntityManager, orderedIds: string[]) {
    await m.query(SET_SORT, [orderedIds, orderedIds.map((_, i) => i + 1)]);
    await m.query(PARK_BRANCH_CODES, [orderedIds]);
    for (const id of orderedIds) await m.query(REBUILD_SUBTREE, [id]);
  }

  /** Run a category change and publish the resulting tree in the same transaction. */
  private async write<T>(fn: (m: EntityManager) => Promise<T>): Promise<T> {
    this.assertOwned();
    return this.db.transaction(async (m) => {
      // One writer at a time: sort numbers and codes are read, then written.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('product_categories'))`);
      const result = await fn(m);
      const rows = await m.query(`SELECT ${CATEGORY_COLUMNS.join(', ')} FROM product_categories ORDER BY level, sort, id`);
      await this.events.publish(new CategoryTreeSnapshot({ rows, version: new Date().toISOString() }), m);
      return result;
    });
  }

  private async find(m: EntityManager, id: string): Promise<CategoryRow | null> {
    const [row] = await m.query(`SELECT * FROM product_categories WHERE id = $1`, [id]);
    return row ?? null;
  }

  private async nextSortOrder(m: EntityManager, parent: CategoryRow | null): Promise<number> {
    const newLevel = parent ? (parent.level ?? 0) + 1 : 0;
    const [{ max }] = newLevel === 1
      ? await m.query(`SELECT COALESCE(MAX(sort), 0) AS max FROM product_categories WHERE level = 1`)
      : parent
        ? await m.query(`SELECT COALESCE(MAX(sort), 0) AS max FROM product_categories WHERE parent_id = $1`, [parent.id])
        : await m.query(`SELECT COALESCE(MAX(sort), 0) AS max FROM product_categories WHERE parent_id IS NULL`);
    return Number(max) + 1;
  }

  /** Same-level names only (case / space-insensitive); the same name on another level is normal. */
  private async assertNoDuplicateName(m: EntityManager, level: number, nameEn: string, nameTh: string | null | undefined, excludeId?: string) {
    const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
    const siblings: CategoryRow[] = await m.query(`SELECT id, category_name_en, category_name_th FROM product_categories WHERE level = $1`, [level]);
    const clash = siblings.find((r) => r.id !== excludeId && (norm(r.category_name_en) === norm(nameEn) || (norm(nameTh) && norm(r.category_name_th) === norm(nameTh))));
    if (clash) throw new ConflictException(`ชื่อหมวดหมู่ "${clash.category_name_en}" ถูกใช้แล้วในระดับเดียวกัน`);
  }

  private assertExactSet(existing: string[], orderedIds: string[], missingLabel: string, unknownLabel: string, head: string) {
    const have = new Set(existing);
    const given = new Set(orderedIds);
    const parts: string[] = [];
    const missing = existing.filter((id) => !given.has(id));
    const unknown = orderedIds.filter((id) => !have.has(id));
    if (missing.length) parts.push(`ขาด${missingLabel}: ${missing.join(', ')}`);
    if (unknown.length) parts.push(`${unknownLabel}: ${unknown.join(', ')}`);
    if (given.size !== orderedIds.length) parts.push('orderedIds มี id ซ้ำ');
    if (parts.length) throw new BadRequestException(`${head} — ${parts.join(' · ')}`);
  }

  private assertOwned() {
    if (!ownsCategories()) throw new ConflictException('หมวดหมู่และแบรนด์ยังแก้ที่ josh (COMMERCE_OWNS_CATEGORIES is not true)');
  }
}
