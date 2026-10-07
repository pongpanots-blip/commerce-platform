import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 4e: product galleries owned by commerce — per SKU the image URLs in display order (josh product_media, images). */
export class ProductImages1795100000000 implements MigrationInterface {
  name = 'ProductImages1795100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE product_images (product_inventory_sku varchar(64) PRIMARY KEY, images jsonb NOT NULL DEFAULT '[]',
      source varchar(16) NOT NULL DEFAULT 'import', updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE product_images`);
  }
}
