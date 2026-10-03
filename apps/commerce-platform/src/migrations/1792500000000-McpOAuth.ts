import { MigrationInterface, QueryRunner } from 'typeorm';

/** OAuth store for the MCP server (AI connectors): registered clients + hashed codes/tokens. */
export class McpOAuth1792500000000 implements MigrationInterface {
  name = 'McpOAuth1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "mcp_oauth_clients" ("client_id" character varying(64) NOT NULL, "info" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_mcp_oauth_clients" PRIMARY KEY ("client_id"))`);
    await queryRunner.query(`CREATE TABLE "mcp_oauth_grants" ("id_hash" character varying(64) NOT NULL, "kind" character varying(12) NOT NULL, "client_id" character varying(64) NOT NULL, "staff_user_id" uuid, "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb, "data" jsonb NOT NULL DEFAULT '{}'::jsonb, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_mcp_oauth_grants" PRIMARY KEY ("id_hash"))`);
    await queryRunner.query(`CREATE INDEX "ix_mcp_oauth_grants_expires" ON "mcp_oauth_grants" ("expires_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "mcp_oauth_grants"`);
    await queryRunner.query(`DROP TABLE "mcp_oauth_clients"`);
  }
}
