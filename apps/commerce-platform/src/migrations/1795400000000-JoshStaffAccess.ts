import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 6: what commerce decided for a josh staff account (role, active, sign-out) — josh applies it from
 * `staff.access` and echoes the result back as `staff.snapshot` (josh_staff). min_token_version: josh raises
 * users.token_version to at least this, which signs the account out everywhere.
 */
export class JoshStaffAccess1795400000000 implements MigrationInterface {
  name = 'JoshStaffAccess1795400000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE josh_staff_access (id uuid PRIMARY KEY, email varchar(255), role varchar(50) NOT NULL,
      is_active boolean NOT NULL, min_token_version int NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar(255))`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query(`DROP TABLE josh_staff_access`); }
}
