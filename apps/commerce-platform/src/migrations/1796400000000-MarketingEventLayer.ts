import { MigrationInterface, QueryRunner } from 'typeorm';

/** Seed catalog = shop-web's analytics events with scalar attributes only (no search free text, no item arrays). */
const SEED: { name: string; label: string; attributes: { key: string; type: string; label: string }[] }[] = [
  { name: 'view_item', label: 'ดูสินค้า', attributes: [
    { key: 'item_id', type: 'string', label: 'รหัสสินค้า' }, { key: 'item_name', type: 'string', label: 'ชื่อสินค้า' },
    { key: 'price', type: 'number', label: 'ราคา' }, { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'view_category', label: 'ดูหมวดสินค้า', attributes: [
    { key: 'category_name', type: 'string', label: 'หมวด' }, { key: 'category2_name', type: 'string', label: 'หมวดย่อย' },
    { key: 'category3_name', type: 'string', label: 'หมวดย่อยชั้น 3' }] },
  { name: 'search', label: 'ค้นหา', attributes: [{ key: 'search_type', type: 'string', label: 'วิธีค้นหา' }] },
  { name: 'add_to_cart', label: 'ใส่ตะกร้า', attributes: [
    { key: 'item_id', type: 'string', label: 'รหัสสินค้า' }, { key: 'item_name', type: 'string', label: 'ชื่อสินค้า' },
    { key: 'quantity', type: 'number', label: 'จำนวน' }, { key: 'price', type: 'number', label: 'ราคา' },
    { key: 'value', type: 'number', label: 'มูลค่า' }, { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'begin_checkout', label: 'เริ่มชำระเงิน', attributes: [
    { key: 'value', type: 'number', label: 'มูลค่า' }, { key: 'item_count', type: 'number', label: 'จำนวนรายการ' },
    { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'purchase', label: 'ซื้อ (จากหน้าเว็บ)', attributes: [
    { key: 'transaction_id', type: 'string', label: 'เลขที่ออเดอร์' }, { key: 'value', type: 'number', label: 'มูลค่า' },
    { key: 'currency', type: 'string', label: 'สกุลเงิน' }] },
  { name: 'login', label: 'เข้าสู่ระบบ', attributes: [] },
];

const monthStart = (d: Date, add: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
const partitionName = (d: Date) => `marketing_events_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Marketing event layer (spec 2026-10-10-marketing-event-layer §4, §13). */
export class MarketingEventLayer1796400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE marketing_event_definitions (
      name varchar(64) PRIMARY KEY, label varchar(120) NOT NULL, description text, attributes jsonb NOT NULL DEFAULT '[]',
      evidence varchar(8) NOT NULL DEFAULT 'browser', status varchar(10) NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT marketing_event_definitions_status CHECK (status IN ('active', 'archived')),
      CONSTRAINT marketing_event_definitions_evidence CHECK (evidence IN ('browser', 'server')))`);
    for (const d of SEED) {
      await q.query(`INSERT INTO marketing_event_definitions (name, label, attributes) VALUES ($1, $2, $3::jsonb)`, [d.name, d.label, JSON.stringify(d.attributes)]);
    }
    // bigserial, not IDENTITY: identity columns on partitioned tables need Postgres 17.
    await q.query(`CREATE TABLE marketing_events (
      id bigserial, schema_version smallint NOT NULL, event_id uuid NOT NULL, device_id varchar(64) NOT NULL, platform varchar(10) NOT NULL,
      source varchar(16) NOT NULL, environment varchar(16) NOT NULL, name varchar(64) NOT NULL, attributes jsonb NOT NULL DEFAULT '{}',
      company_id varchar(100), branch_id varchar(100), actor_kind varchar(10), occurred_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(), attributed_user_id uuid, attribution varchar(16),
      PRIMARY KEY (id, occurred_at), CONSTRAINT marketing_events_once UNIQUE (event_id, occurred_at)
    ) PARTITION BY RANGE (occurred_at)`);
    await q.query(`CREATE INDEX marketing_events_user ON marketing_events (attributed_user_id, name, occurred_at) WHERE attributed_user_id IS NOT NULL`);
    await q.query(`CREATE INDEX marketing_events_device ON marketing_events (device_id, occurred_at)`);
    await q.query(`CREATE TABLE marketing_events_default PARTITION OF marketing_events DEFAULT`);
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const from = monthStart(now, i); const to = monthStart(now, i + 1);
      await q.query(`CREATE TABLE ${partitionName(from)} PARTITION OF marketing_events FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`);
    }
    await q.query(`CREATE TABLE marketing_event_coverage (platform varchar(10) PRIMARY KEY, collecting_since timestamptz NOT NULL)`);
    await q.query(`CREATE TABLE marketing_devices (device_id varchar(64) PRIMARY KEY, platform varchar(10) NOT NULL, push_subscription_id uuid,
      first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE marketing_device_links (id bigserial PRIMARY KEY, device_id varchar(64) NOT NULL, user_id uuid NOT NULL,
      platform varchar(10) NOT NULL, linked_at timestamptz NOT NULL, is_staff boolean NOT NULL DEFAULT false,
      CONSTRAINT marketing_device_links_once UNIQUE (device_id, linked_at))`);
    await q.query(`CREATE INDEX marketing_device_links_user ON marketing_device_links (user_id)`);
    await q.query(`CREATE TABLE marketing_event_daily (date date NOT NULL, name varchar(64) NOT NULL, platform varchar(10) NOT NULL,
      events int NOT NULL, users int NOT NULL, devices int NOT NULL, PRIMARY KEY (date, name, platform))`);
    await q.query(`CREATE TABLE marketing_dynamic_segments (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar(155) NOT NULL,
      description text, rule jsonb NOT NULL, created_by varchar(128), created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE marketing_guest_push_log (id bigserial PRIMARY KEY, device_id varchar(64) NOT NULL, sent_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX marketing_guest_push_log_device ON marketing_guest_push_log (device_id, sent_at)`);
    // josh user_devices copy (device.snapshot; reference-copy version guard).
    await q.query(`CREATE TABLE josh_user_devices (id uuid PRIMARY KEY, user_id uuid, individual_id varchar(64), platform varchar(20),
      first_seen_at timestamptz, last_seen_at timestamptz, source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`ALTER TABLE marketing_workflow_enrollments ALTER COLUMN user_id DROP NOT NULL,
      ADD COLUMN device_id varchar(64), ADD COLUMN waiting_for jsonb, ADD COLUMN trigger_event jsonb,
      ADD CONSTRAINT marketing_workflow_enrollments_who CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)`);
    await q.query(`CREATE UNIQUE INDEX marketing_workflow_enrollments_guest_once ON marketing_workflow_enrollments (workflow_id, device_id, occurrence_key) WHERE user_id IS NULL`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_guest ON marketing_workflow_enrollments (device_id) WHERE user_id IS NULL AND status IN ('pending', 'running')`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_waiting ON marketing_workflow_enrollments ((waiting_for->>'eventName')) WHERE waiting_for IS NOT NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM marketing_workflow_enrollments WHERE user_id IS NULL`);
    await q.query(`DROP INDEX marketing_workflow_enrollments_waiting`);
    await q.query(`DROP INDEX marketing_workflow_enrollments_guest`);
    await q.query(`DROP INDEX marketing_workflow_enrollments_guest_once`);
    await q.query(`ALTER TABLE marketing_workflow_enrollments DROP CONSTRAINT marketing_workflow_enrollments_who,
      DROP COLUMN trigger_event, DROP COLUMN waiting_for, DROP COLUMN device_id, ALTER COLUMN user_id SET NOT NULL`);
    for (const t of ['josh_user_devices', 'marketing_guest_push_log', 'marketing_dynamic_segments', 'marketing_event_daily', 'marketing_device_links',
      'marketing_devices', 'marketing_event_coverage', 'marketing_events', 'marketing_event_definitions']) {
      await q.query(`DROP TABLE ${t}`); // dropping marketing_events drops its partitions
    }
  }
}
