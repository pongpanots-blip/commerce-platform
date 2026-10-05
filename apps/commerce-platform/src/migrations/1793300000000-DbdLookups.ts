import { MigrationInterface, QueryRunner } from 'typeorm';

/** Last DBD juristic-person answer per register number (relayed for josh onboarding). */
export class DbdLookups1793300000000 implements MigrationInterface {
  name = 'DbdLookups1793300000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "dbd_lookups" (
      "register_number" character varying(13) NOT NULL,
      "http_status" integer NOT NULL,
      "body" jsonb,
      "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "PK_dbd_lookups" PRIMARY KEY ("register_number"))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "dbd_lookups"`);
  }
}
