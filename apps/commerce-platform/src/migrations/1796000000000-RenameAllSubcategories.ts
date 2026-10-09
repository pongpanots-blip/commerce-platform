import { MigrationInterface, QueryRunner } from 'typeorm';
import { OUTBOX_CHANNEL } from '../shared-kernel/infrastructure/outbox-relay.worker';
import { ALL_CATEGORY_ID, CATEGORY_COLUMNS, ownsCategories } from '../modules/commerce/product-categories/category-rules';
import { CategoryTreeSnapshot } from '../modules/commerce/product-categories/category-tree.events';

/**
 * The level-3 "All Type" rows (code `…-ALL`) → "All Types".
 * Done here because the admin rename can't: same-level names must be unique, and a rename rebuilds the code from sort (drops `-ALL`).
 * Publishes category.tree.snapshot like ProductCategoriesService.write() so josh gets the names; skipped while josh still owns categories.
 */
export class RenameAllSubcategories1796000000000 implements MigrationInterface {
  name = 'RenameAllSubcategories1796000000000';

  async up(q: QueryRunner): Promise<void> {
    await this.rename(q, 'All Type', 'All Types');
  }

  async down(q: QueryRunner): Promise<void> {
    await this.rename(q, 'All Types', 'All Type');
  }

  private async rename(q: QueryRunner, from: string, to: string) {
    // Raw UPDATE on postgres answers [rows, rowCount].
    const [, renamed]: [unknown[], number] = await q.query(
      `UPDATE product_categories c SET category_name_en = $2, category_path = p.category_path || ' > ' || $2, updated_at = now()
       FROM product_categories p
       WHERE p.id = c.parent_id AND c.category_code LIKE '%-ALL' AND lower(trim(c.category_name_en)) = lower($1)`,
      [from, to],
    );
    if (!renamed || !ownsCategories()) return;
    const rows = await q.query(
      `SELECT ${CATEGORY_COLUMNS.join(', ')}, (id = $1) AS is_all_category FROM product_categories ORDER BY level, sort, id`,
      [ALL_CATEGORY_ID],
    );
    const event = new CategoryTreeSnapshot({ rows, version: new Date().toISOString() });
    await q.query(
      `INSERT INTO outbox_messages (type, aggregate_id, payload, metadata, status, attempts) VALUES ($1, $2, $3, $4, 'pending', 0)`,
      [event.type, event.aggregateId, JSON.stringify(event.payload), JSON.stringify(event.metadata)],
    );
    await q.query(`SELECT pg_notify('${OUTBOX_CHANNEL}', '')`);
  }
}
