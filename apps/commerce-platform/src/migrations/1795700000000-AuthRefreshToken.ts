import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * auth_refresh_token — rotating refresh tokens for commerce-admin (staff) and developer-portal sign-ins.
 * Only the sha256 of each token is stored. Additive only: a new table, nothing else is touched.
 */
export class AuthRefreshToken1795700000000 implements MigrationInterface {
  name = 'AuthRefreshToken1795700000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS auth_refresh_token (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    audience character varying(12) NOT NULL,
    role_at_issue character varying(24) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_reason character varying(32),
    replaced_by_id uuid,
    user_agent character varying(255),
    ip character varying(64))`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_refresh_token_hash ON auth_refresh_token (token_hash)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_auth_refresh_token_user ON auth_refresh_token (user_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ix_auth_refresh_token_family ON auth_refresh_token (family_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS auth_refresh_token`);
  }
}
