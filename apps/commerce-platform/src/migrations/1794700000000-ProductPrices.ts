import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 4a: product prices owned by commerce — base price (selling_unit_price), ERP box price (ordering_price) and MOQ
 * per SKU (column names as josh's product_inventory, so the import copies them as-is), and the MER queue of ERP changes
 * waiting for approval.
 */
export class ProductPrices1794700000000 implements MigrationInterface {
  name = 'ProductPrices1794700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE product_prices (product_inventory_sku varchar(64) PRIMARY KEY, selling_unit_price numeric(12,2),
      ordering_price numeric(12,2), moq int, source varchar(16) NOT NULL DEFAULT 'import', updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE product_price_pending (product_inventory_sku varchar(64) PRIMARY KEY, selling_unit_price numeric(12,2),
      ordering_price numeric(12,2), moq int, changed_at timestamptz, received_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE product_price_pending`);
    await q.query(`DROP TABLE product_prices`);
  }
}
