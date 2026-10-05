import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional member-account login per scraping source; password stored encrypted (credential-cipher.ts).
 * Same DDL as josh migration 1792260000000-ScrapingSourceLogin, so import-from-josh copies the columns 1:1.
 */
export class ScrapingSourceLogin1792700000000 implements MigrationInterface {
  name = 'ScrapingSourceLogin1792700000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scraping_sources" ADD "login_url" character varying(2000)`);
    await queryRunner.query(`ALTER TABLE "scraping_sources" ADD "login_username" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "scraping_sources" ADD "login_password_enc" text`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scraping_sources" DROP COLUMN "login_password_enc"`);
    await queryRunner.query(`ALTER TABLE "scraping_sources" DROP COLUMN "login_username"`);
    await queryRunner.query(`ALTER TABLE "scraping_sources" DROP COLUMN "login_url"`);
  }
}
