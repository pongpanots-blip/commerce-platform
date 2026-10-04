import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every snapshot delivery (stock / price / moq, order periods) checks for a newer delivery of the same
 * aggregate before it is sent. Without this index that lookup scans the subscription's whole history.
 * Plain CREATE INDEX (migrations run in one transaction here): commerce is not live yet, so the table
 * is small. ponytail: once it is large, build it by hand with CONCURRENTLY before deploying.
 */
export class WebhookDeliverySupersedeIndex1792600000000 implements MigrationInterface {
  name = 'WebhookDeliverySupersedeIndex1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "ix_webhook_deliveries_snapshot_agg"
      ON "webhook_deliveries" ("subscription_id", "event_type", (payload ->> 'aggregateId'), "created_at")
      WHERE (payload ->> 'snapshot') = 'true'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_webhook_deliveries_snapshot_agg"`);
  }
}
