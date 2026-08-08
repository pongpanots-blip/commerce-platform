import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIntegrationSlug1784108912731 implements MigrationInterface {
    name = 'AddIntegrationSlug1784108912731'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "integrations" ADD "slug" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "integrations" ADD CONSTRAINT "UQ_29dd88d86138f3197717eb6bdcb" UNIQUE ("slug")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "integrations" DROP CONSTRAINT "UQ_29dd88d86138f3197717eb6bdcb"`);
        await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "slug"`);
    }

}
