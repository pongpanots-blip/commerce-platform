import { MigrationInterface, QueryRunner } from 'typeorm';

/** Josh web #549. Same id as josh so category parity and category_image edits see one row. applyTree will not delete it; this seed is what makes the values match. */
export class AllCategory1795600000000 implements MigrationInterface {
  name = 'AllCategory1795600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS is_all_category boolean NOT NULL DEFAULT false`);
    await q.query(`INSERT INTO product_categories (
        id, parent_id, category_code, category_name_en, category_name_th, category_path, category_path_code,
        sort, level, is_active, category_image, show_on_homepage, default_sort_key, sort_options, cat_code, is_all_category
      ) VALUES (
        '00000000-0000-4000-8000-000000000a11', NULL, 'ALL', 'All', 'ทั้งหมด', 'All', 'ALL',
        0, 1, true, NULL, true, NULL, '[]'::jsonb, 'ALL', true
      ) ON CONFLICT (id) DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM product_categories WHERE id = '00000000-0000-4000-8000-000000000a11'`);
    await q.query(`ALTER TABLE product_categories DROP COLUMN IF EXISTS is_all_category`);
  }
}
