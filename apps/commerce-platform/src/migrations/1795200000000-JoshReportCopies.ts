import { MigrationInterface, QueryRunner } from 'typeorm';

/** catalog.snapshot fields added in stage 5 (josh migration CommerceOutboxCatalogReportFields), typed as in josh. */
const CATALOG_COLS: Array<[string, string]> = [
  ['category_id', 'uuid'],
  ['category_path', 'varchar(255)'],
  ['original_price', 'numeric(12,2)'],
  ['sup_code', 'varchar(50)'],
  ['product_inventory_quantity', 'int'],
  ['low_stock_threshold', 'int'],
  ['moq', 'int'],
  ['order_taking_flag', 'varchar(10)'],
  ['erp_pending_source', 'varchar(32)'],
  ['erp_pending_at', 'timestamptz'],
  ['image_count', 'int'],
];
const COMPANY_COLS: Array<[string, string]> = [
  ['business_type', 'varchar(20)'],
  ['erp_customer_code', 'varchar(100)'],
  ['document_language', 'varchar(20)'],
  ['created_at', 'timestamptz'],
];

/**
 * Stage 5 (plan 2026-10-08, S5-11): the copies commerce's reports read instead of josh's replica, fed by josh events.
 * All additive and nullable — a column josh has not sent yet stays null, never a guessed 0:
 * - josh_catalog_products: the products report fields of catalog.snapshot;
 * - josh_companies: business type, ERP customer code (company.snapshot);
 * - josh_branches: new reference copy (branch.snapshot) — name + ERP codes, no address / phone;
 * - josh_orders.sending_date + josh_order_payments / _shipments / _refunds: replaced per order from order.snapshot;
 * - jagota_order_sync_history.source_version: the import table also takes jagota_sync.snapshot events.
 */
export class JoshReportCopies1795200000000 implements MigrationInterface {
  name = 'JoshReportCopies1795200000000';

  async up(q: QueryRunner): Promise<void> {
    for (const [c, t] of CATALOG_COLS) await q.query(`ALTER TABLE josh_catalog_products ADD COLUMN IF NOT EXISTS ${c} ${t} NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS ix_josh_catalog_product_category ON josh_catalog_products (category_id)`);
    for (const [c, t] of COMPANY_COLS) await q.query(`ALTER TABLE josh_companies ADD COLUMN IF NOT EXISTS ${c} ${t} NULL`);
    await q.query(`CREATE TABLE IF NOT EXISTS josh_branches (id uuid PRIMARY KEY, name varchar(255), company_id uuid NULL, shop_id uuid NULL,
      type varchar(50), erp_branch_code varchar(100), erp_branch_seq varchar(100), erp_branch_no bigint, erp_sync_status varchar(20),
      is_default_delivery boolean, subdistrict_code int, created_at timestamptz, source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`CREATE INDEX IF NOT EXISTS ix_josh_branches_company ON josh_branches (company_id)`);

    await q.query(`ALTER TABLE josh_orders ADD COLUMN IF NOT EXISTS sending_date timestamptz NULL`);
    await q.query(`CREATE TABLE IF NOT EXISTS josh_order_payments (orders_id uuid NOT NULL, id uuid NOT NULL, status varchar(20),
      payment_method varchar(30), amount numeric(12,2), allocated_amount numeric(12,2), gateway_provider varchar(20), is_test boolean,
      paid_at timestamptz, created_at timestamptz, PRIMARY KEY (orders_id, id))`);
    await q.query(`CREATE TABLE IF NOT EXISTS josh_order_shipments (orders_id uuid NOT NULL, id uuid NOT NULL, shipment_number varchar(50),
      status varchar(32), fulfillment_type varchar(32), delivery_date date, shipped_at timestamptz, delivered_at timestamptz,
      cancelled_at timestamptz, total_inc_vat numeric(12,2), erp_sync_status varchar(20), three_pl_status varchar(32), created_at timestamptz,
      PRIMARY KEY (orders_id, id))`);
    await q.query(`CREATE TABLE IF NOT EXISTS josh_order_refunds (orders_id uuid NOT NULL, id uuid NOT NULL, amount numeric(12,2),
      status varchar(30), resolution_type varchar(20), source varchar(20), approved_at timestamptz, rejected_at timestamptz,
      processed_at timestamptz, created_at timestamptz, updated_at timestamptz, PRIMARY KEY (orders_id, id))`);
    await q.query(`CREATE INDEX IF NOT EXISTS ix_josh_order_refunds_created ON josh_order_refunds (created_at)`);

    await q.query(`ALTER TABLE jagota_order_sync_history ADD COLUMN IF NOT EXISTS source_version bigint NOT NULL DEFAULT 0`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE jagota_order_sync_history DROP COLUMN IF EXISTS source_version`);
    for (const t of ['josh_order_refunds', 'josh_order_shipments', 'josh_order_payments', 'josh_branches']) await q.query(`DROP TABLE IF EXISTS ${t}`);
    await q.query(`ALTER TABLE josh_orders DROP COLUMN IF EXISTS sending_date`);
    for (const [c] of COMPANY_COLS) await q.query(`ALTER TABLE josh_companies DROP COLUMN IF EXISTS ${c}`);
    await q.query(`DROP INDEX IF EXISTS ix_josh_catalog_product_category`);
    for (const [c] of CATALOG_COLS) await q.query(`ALTER TABLE josh_catalog_products DROP COLUMN IF EXISTS ${c}`);
  }
}
