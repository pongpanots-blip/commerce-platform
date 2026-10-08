import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * winback_app_record — the records behind the saleactivity screens that had no API (drafts, coaching tasks,
 * work plans, saved places, quotes, daily reports, sync runs, …): one table, `kind` + jsonb `payload`.
 * Same DDL as josh's 1792440000000-WinbackAppRecord (WinbackMirror copies it like the six winback tables).
 * Additive only.
 */
export class WinbackAppRecord1795500000000 implements MigrationInterface {
  name = 'WinbackAppRecord1795500000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS winback_app_record (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    kind character varying(40) NOT NULL,
    record_key character varying(200),
    sales_user_id uuid,
    account_id uuid,
    status character varying(30),
    version integer DEFAULT 1 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    create_date timestamp with time zone DEFAULT now() NOT NULL,
    update_date timestamp with time zone DEFAULT now() NOT NULL)`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_winback_app_record_key ON winback_app_record (kind, record_key) WHERE record_key IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_winback_app_record_kind_sales ON winback_app_record (kind, sales_user_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_winback_app_record_kind_account ON winback_app_record (kind, account_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS winback_app_record`);
  }
}
