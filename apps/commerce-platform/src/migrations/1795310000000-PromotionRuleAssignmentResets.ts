import { MigrationInterface, QueryRunner } from 'typeorm';

/** Remember mechanic assignments even when their assigned lock snapshot was superseded. */
export class PromotionRuleAssignmentResets1795310000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE product_promotion_rules ADD COLUMN rules_reset_version bigint NOT NULL DEFAULT 0');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE product_promotion_rules DROP COLUMN rules_reset_version');
  }
}
