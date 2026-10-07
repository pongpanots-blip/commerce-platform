import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 2b: the company → sales rep assignment, owned here (josh `company.assigned_sales_user_id` follows). id = josh company id. */
export class CompanySalesReps1794400000000 implements MigrationInterface {
  name = 'CompanySalesReps1794400000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE company_sales_reps (
      id uuid PRIMARY KEY, assigned_sales_user_id uuid NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX "IDX_company_sales_reps_user" ON company_sales_reps (assigned_sales_user_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE company_sales_reps`);
  }
}
