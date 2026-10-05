import { MigrationInterface, QueryRunner } from 'typeorm';

/** Checkout step 2: commerce's copy of every josh order and its lines. */
export class JoshOrderCopies1793600000000 implements MigrationInterface {
  name = 'JoshOrderCopies1793600000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "josh_orders" (
      "orders_id" uuid NOT NULL, "order_number" character varying(100), "status" character varying(50) NOT NULL,
      "payment_type" character varying(50), "paid" boolean NOT NULL DEFAULT false, "fulfillment_type" character varying(50),
      "user_id" uuid, "company_id" uuid, "branch_id" uuid, "customer_code" character varying(100), "checkout_batch_id" uuid,
      "total_price" numeric(14,2), "subtotal_ex_vat" numeric(14,2), "vat_amount" numeric(14,2), "delivery_fee" numeric(14,2),
      "discount_amount" numeric(14,2), "discount_inc_vat" numeric(14,2), "product_discount_ex_vat" numeric(14,2), "gross_ex_vat" numeric(14,2),
      "delivery_date" date, "po_number" character varying(100), "document_no" character varying(100), "remark" text,
      "create_date" TIMESTAMP WITH TIME ZONE NOT NULL, "end_date" TIMESTAMP WITH TIME ZONE,
      "copied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_josh_orders" PRIMARY KEY ("orders_id"))`);
    await queryRunner.query(`CREATE INDEX "ix_josh_orders_create_date" ON "josh_orders" ("create_date")`);
    await queryRunner.query(`CREATE INDEX "ix_josh_orders_company" ON "josh_orders" ("company_id", "create_date")`);
    await queryRunner.query(`CREATE TABLE "josh_order_lines" (
      "id" uuid NOT NULL, "orders_id" uuid NOT NULL, "product_inventory_id" uuid, "sku" character varying(100),
      "product_price" numeric(14,2) NOT NULL, "product_quantity" integer NOT NULL, "status" character varying(50),
      "fulfillment_type" character varying(50), "price_source" character varying(50), "promotion_mechanic_id" uuid,
      "unit_list_price_inc_vat" numeric(14,2), "line_revenue" numeric(14,2), "shipment_id" uuid,
      CONSTRAINT "PK_josh_order_lines" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "ix_josh_order_lines_order" ON "josh_order_lines" ("orders_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "josh_order_lines"`);
    await queryRunner.query(`DROP TABLE "josh_orders"`);
  }
}
