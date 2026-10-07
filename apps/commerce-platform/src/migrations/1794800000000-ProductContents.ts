import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 4b: product content owned by commerce — per SKU, the content keys commerce holds (content-fields.ts: names /
 * descriptions th / en, ingredients, cost …) as one jsonb, keyed like josh (product_inventory_sku).
 */
export class ProductContents1794800000000 implements MigrationInterface {
  name = 'ProductContents1794800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE product_contents (product_inventory_sku varchar(64) PRIMARY KEY, fields jsonb NOT NULL DEFAULT '{}',
      source varchar(16) NOT NULL DEFAULT 'import', updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE product_contents`);
  }
}
