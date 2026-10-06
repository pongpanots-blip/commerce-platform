import { MigrationInterface, QueryRunner } from 'typeorm';

/** Set when someone else chose the password (new account, reset); cleared when the owner changes it. */
export class StaffMustChangePassword1794000000000 implements MigrationInterface {
  name = 'StaffMustChangePassword1794000000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "users" ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE "users" DROP COLUMN "must_change_password"'); }
}
