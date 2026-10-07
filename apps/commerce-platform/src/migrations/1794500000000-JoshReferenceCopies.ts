import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 2c: the josh reference rows winback reads, copied from josh events (columns named and typed as in josh), so
 * winback runs without josh's replica. A delete leaves a tombstone (josh_reference_tombstones) so an older snapshot
 * delivered late cannot bring the row — or a staff sign-in — back. erp_sales_history is a static ERP export: imported
 * once (import-from-josh erp-sales-history), only the columns winback reads.
 * josh_users = customers (customer.snapshot) ∪ staff (staff.snapshot): the `users` winback's entities read.
 */
export class JoshReferenceCopies1794500000000 implements MigrationInterface {
  name = 'JoshReferenceCopies1794500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE josh_companies (id uuid PRIMARY KEY, name varchar(255), register_number varchar(250),
      source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`CREATE TABLE josh_cuisines (id uuid PRIMARY KEY, parent_id uuid NULL, cuisine_name varchar(100) NOT NULL,
      cuisine_name_th varchar(100), level int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
      source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`CREATE TABLE josh_restaurant_places (id uuid PRIMARY KEY, name_th varchar(255), name_en varchar(255),
      lat numeric(10,7) NOT NULL, lng numeric(10,7) NOT NULL, district varchar(100), raw_category varchar(255), fsq_id varchar(50),
      osm_id varchar(50), google_place_id varchar(100), source varchar(20) NOT NULL, rating numeric(3,2), review_count int,
      price_range varchar(20), popular_times jsonb, opening_hours jsonb, dine_in boolean, takeaway boolean, delivery boolean,
      enriched_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`CREATE TABLE josh_staff (id uuid PRIMARY KEY, email varchar(255), first_name varchar(100), last_name varchar(100),
      role varchar(50), user_type varchar(20), is_active boolean NOT NULL DEFAULT true, token_version int NOT NULL DEFAULT 0,
      company_id uuid NULL, created_at timestamptz, last_app_login_at timestamptz, source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`CREATE TABLE josh_erp_sales_history (id bigint PRIMARY KEY, cust_code varchar(16) NOT NULL, inv_date date NOT NULL,
      total numeric(16,4), del_province varchar(64))`);
    await q.query(`CREATE INDEX "IDX_josh_esh_code_date" ON josh_erp_sales_history (upper(trim(cust_code)), inv_date)`);
    await q.query(`CREATE TABLE josh_reference_tombstones (tbl varchar(40) NOT NULL, id uuid NOT NULL, source_version bigint NOT NULL,
      PRIMARY KEY (tbl, id))`);
    await q.query(`CREATE INDEX "IDX_josh_orders_customer_code" ON josh_orders (upper(trim(customer_code)))`);
    await q.query(`CREATE VIEW josh_users AS
      SELECT c.id, c.data->>'email' AS email, c.data->>'first_name' AS first_name, c.data->>'last_name' AS last_name,
        c.data->>'role' AS role, COALESCE((c.data->>'is_active')::boolean, true) AS is_active,
        NULLIF(c.data->>'company_id', '')::uuid AS company_id, c.data->>'custcode' AS custcode, c.data->>'legacy_custcode' AS legacy_custcode,
        (c.data->>'created_at')::timestamptz AS created_at, (c.data->>'last_app_login_at')::timestamptz AS last_app_login_at,
        COALESCE((c.data->>'onboarding_completed')::boolean, false) AS onboarding_completed, false AS internal
      FROM josh_customers c WHERE c.deleted_at IS NULL
      UNION ALL
      SELECT s.id, s.email, s.first_name, s.last_name, s.role, s.is_active, s.company_id, NULL, NULL, s.created_at, s.last_app_login_at,
        true, s.user_type = 'internal'
      FROM josh_staff s WHERE s.user_type IS DISTINCT FROM 'customer'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP VIEW josh_users`);
    await q.query(`DROP INDEX "IDX_josh_orders_customer_code"`);
    for (const t of ['josh_reference_tombstones', 'josh_erp_sales_history', 'josh_staff', 'josh_restaurant_places', 'josh_cuisines', 'josh_companies']) {
      await q.query(`DROP TABLE ${t}`);
    }
  }
}
