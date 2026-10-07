import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 2a (plan 2026-10-07): commerce owns customer metrics and segments.
 * - customer_metrics: computed here from josh_orders (order.snapshot copy) and pushed to josh.
 * - segments / segment_members: definitions (same ids as josh user_segments) and frozen members, sent to josh.
 * - segment_customers: the `u` of josh's segment base query (FROM users u), over the customer.snapshot copy.
 *   Customers only: staff-only live segments are matched in josh.
 */
export class CustomerMarketing1794300000000 implements MigrationInterface {
  name = 'CustomerMarketing1794300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE customer_metrics (user_id uuid PRIMARY KEY, lifetime_order_count int NOT NULL DEFAULT 0,
      lifetime_spend numeric(14,2) NOT NULL DEFAULT 0, avg_order_value numeric(14,2) NOT NULL DEFAULT 0,
      first_order_at timestamptz, last_order_at timestamptz, order_count_90d int NOT NULL DEFAULT 0,
      spend_90d numeric(14,2) NOT NULL DEFAULT 0, computed_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE segments (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), slug varchar(80) NOT NULL UNIQUE,
      name varchar(155) NOT NULL, description text, rule_type varchar(40) NOT NULL, rule_config jsonb NOT NULL DEFAULT '{}',
      definition jsonb, priority int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, frozen_at timestamptz,
      member_count int, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE segment_members (segment_id uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      user_id uuid NOT NULL, matched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (segment_id, user_id))`);
    await q.query(`CREATE INDEX ix_segment_members_user ON segment_members (user_id)`);
    await q.query(`CREATE VIEW segment_customers AS SELECT c.id,
      c.data->>'first_name' AS first_name, c.data->>'last_name' AS last_name, c.data->>'email' AS email,
      NULLIF(c.data->>'company_id', '')::uuid AS company_id, c.data->>'custype' AS custype, c.data->>'role' AS role,
      (c.data->>'created_at')::timestamptz AS created_at, c.data->>'tier_slug' AS tier_slug,
      c.data->>'cuisine_name' AS cuisine_name, NULLIF(c.data->>'cuisine_parent_id', '')::uuid AS cuisine_parent_id
      FROM josh_customers c WHERE c.deleted_at IS NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP VIEW segment_customers`);
    await q.query(`DROP TABLE segment_members`);
    await q.query(`DROP TABLE segments`);
    await q.query(`DROP TABLE customer_metrics`);
  }
}
