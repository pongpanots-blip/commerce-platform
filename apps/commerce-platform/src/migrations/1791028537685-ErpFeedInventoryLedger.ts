import { MigrationInterface, QueryRunner } from "typeorm";

export class ErpFeedInventoryLedger1791028537685 implements MigrationInterface {
    name = 'ErpFeedInventoryLedger1791028537685'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Generated output also tried to DROP the hand-written expression index
        // "UQ_products_org_sku" (TypeORM can't see it in entity metadata) — removed.
        await queryRunner.query(`CREATE TABLE "inventory_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "product_id" uuid NOT NULL, "warehouse_id" uuid NOT NULL, "source" character varying(16) NOT NULL, "reason" character varying(32), "quantity_after" numeric(14,4) NOT NULL, "status" character varying(12) NOT NULL, "ref" character varying(128), "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_d7597827c1dcffae889db3ab873" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_796152a27e272156c46e9c7a8b" ON "inventory_movements" ("product_id", "warehouse_id", "occurred_at") `);
        await queryRunner.query(`ALTER TABLE "warehouses" ADD "stock_source" character varying(16) NOT NULL DEFAULT 'erp'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN "stock_source"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_796152a27e272156c46e9c7a8b"`);
        await queryRunner.query(`DROP TABLE "inventory_movements"`);
    }

}
