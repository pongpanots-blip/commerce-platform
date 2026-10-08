import { MigrationInterface, QueryRunner } from 'typeorm';

/** Raw identity lookup table, like company_sales_reps; no ORM relation to the imported Josh copy. */
export class WinbackStaffLinks1795700000000 implements MigrationInterface {
  name = 'WinbackStaffLinks1795700000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE winback_staff_links (
      josh_user_id uuid PRIMARY KEY,
      commerce_user_id uuid NOT NULL UNIQUE,
      method varchar(16) NOT NULL DEFAULT 'email',
      linked_at timestamptz NOT NULL DEFAULT now())`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE winback_staff_links');
  }
}
