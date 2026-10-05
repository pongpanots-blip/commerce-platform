import { MigrationInterface, QueryRunner } from 'typeorm';

/** Shop live chat traffic relayed between josh and CS-CRM. */
export class LivechatLogs1793500000000 implements MigrationInterface {
  name = 'LivechatLogs1793500000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "livechat_logs" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "direction" character varying(12) NOT NULL,
      "route" character varying(120) NOT NULL,
      "visitor_id" character varying(100),
      "text" text,
      "status" integer NOT NULL,
      "payload" jsonb,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_livechat_logs" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "ix_livechat_logs_visitor" ON "livechat_logs" ("visitor_id", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "livechat_logs"`);
  }
}
