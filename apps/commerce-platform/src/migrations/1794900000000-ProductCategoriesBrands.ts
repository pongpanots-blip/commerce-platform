import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 4c: the shop's category tree and brand names owned by commerce — josh's product_category / brand columns and
 * unique indexes as they are, so commerce refuses what josh would and the tree snapshot is josh's rows verbatim.
 */
export class ProductCategoriesBrands1794900000000 implements MigrationInterface {
  name = 'ProductCategoriesBrands1794900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE product_categories (id uuid PRIMARY KEY, parent_id uuid, category_code varchar(100),
      category_name_en varchar(100), category_name_th varchar(100), category_path varchar(255), category_path_code varchar(300),
      sort int, level int, is_active boolean, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      category_image text, show_on_homepage boolean NOT NULL DEFAULT true, default_sort_key varchar(100), sort_options jsonb DEFAULT '[]'::jsonb,
      cat_code varchar(255))`);
    await q.query(`CREATE UNIQUE INDEX uq_product_categories_code ON product_categories (category_code)`);
    await q.query(`CREATE UNIQUE INDEX uq_product_categories_level_cat_code ON product_categories (level, cat_code)`);
    await q.query(`CREATE INDEX idx_product_categories_parent ON product_categories (parent_id)`);
    await q.query(`CREATE TABLE product_brands (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), brand_code varchar(100) NOT NULL UNIQUE,
      brand_name_th varchar(255), brand_name_en varchar(255), updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE product_brands`);
    await q.query(`DROP TABLE product_categories`);
  }
}
