import { MigrationInterface, QueryRunner } from 'typeorm';
/** Proposal persistence only; never modifies operational prices, campaigns, stock, events or roles. */
export class CommercePromotionDrafts1796200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE commerce_promotion_drafts (id uuid PRIMARY KEY, actor_id varchar(128) NOT NULL,
      revision integer NOT NULL CHECK (revision > 0), scenario jsonb NOT NULL, evidence jsonb NOT NULL, preview jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query('CREATE INDEX commerce_promotion_drafts_actor ON commerce_promotion_drafts(actor_id, updated_at DESC, id)');
    await q.query(`CREATE TABLE commerce_promotion_draft_requests (actor_id varchar(128) NOT NULL, request_id uuid NOT NULL,
      request_hash varchar(64) NOT NULL, draft_id uuid NOT NULL REFERENCES commerce_promotion_drafts(id), receipt jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id, request_id))`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE commerce_promotion_draft_requests'); await q.query('DROP TABLE commerce_promotion_drafts'); }
}
