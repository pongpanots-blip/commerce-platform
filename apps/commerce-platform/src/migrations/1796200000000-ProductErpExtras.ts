import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ERP product extras (spec "ขอข้อมูลสินค้าเพิ่มจาก ERP", 2026-10-09): Aging, min prices, substitutes and the FDA album,
 * sent in the ERP product upsert. Commerce-only: josh gets the raw upsert through the relay as before.
 */
export class ProductErpExtras1796200000000 implements MigrationInterface {
  name = 'ProductErpExtras1796200000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE product_erp_extras (
      product_inventory_sku varchar(64) PRIMARY KEY,
      aging_days integer NULL,
      min_price numeric(12,2) NULL,
      min_selling_unit_price numeric(12,2) NULL,
      substitutes jsonb NOT NULL DEFAULT '[]',
      fda_images jsonb NOT NULL DEFAULT '[]',
      updated_at timestamptz NOT NULL DEFAULT now())`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE product_erp_extras`);
  }
}
