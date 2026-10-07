import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 4d: the ERP product master owned by commerce — per live SKU the ERP-fed fields (master-fields.ts, josh's
 * pending-patch keys) as one jsonb, and the MER queue of ERP changes to them.
 */
export class ProductMasters1795000000000 implements MigrationInterface {
  name = 'ProductMasters1795000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE product_masters (product_inventory_sku varchar(64) PRIMARY KEY, fields jsonb NOT NULL DEFAULT '{}',
      source varchar(16) NOT NULL DEFAULT 'import', updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE product_master_pending (product_inventory_sku varchar(64) PRIMARY KEY, patch jsonb NOT NULL DEFAULT '{}',
      changed_at timestamptz, received_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE product_master_pending`);
    await q.query(`DROP TABLE product_masters`);
  }
}
