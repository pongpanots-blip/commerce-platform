import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 4f: ordering / logistics owned by commerce — the ERP's supplier order rounds (josh's supplier_order_period columns
 * and key) and each SKU's logistics fields (logistics-fields.ts) as one jsonb.
 */
export class OrderingLogistics1795150000000 implements MigrationInterface {
  name = 'OrderingLogistics1795150000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE supplier_order_periods (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), sup_code varchar(50) NOT NULL,
      erp_order_period varchar(50) NOT NULL, date_from date NOT NULL, date_to date NOT NULL, close_at timestamptz,
      status varchar(5) NOT NULL DEFAULT 'N', synced_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_supplier_order_periods UNIQUE (sup_code, erp_order_period))`);
    await q.query(`CREATE TABLE product_logistics (product_inventory_sku varchar(64) PRIMARY KEY, fields jsonb NOT NULL DEFAULT '{}',
      source varchar(16) NOT NULL DEFAULT 'import', updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE product_logistics`);
    await q.query(`DROP TABLE supplier_order_periods`);
  }
}
