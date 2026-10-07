import { MigrationInterface, QueryRunner } from 'typeorm';
export class ProductPromotionRules1795300000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE SEQUENCE product_promotion_rules_seq`);
    await q.query(`CREATE TABLE product_promotion_rules (sku varchar(64) PRIMARY KEY, rules jsonb NOT NULL DEFAULT '[]',
      version bigint, source text NOT NULL DEFAULT 'josh', updated_by text, shadow_rules jsonb NOT NULL DEFAULT '[]', shadow_version bigint,
      lock jsonb, lock_version bigint)`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE product_promotion_rules'); await q.query('DROP SEQUENCE product_promotion_rules_seq'); }
}
