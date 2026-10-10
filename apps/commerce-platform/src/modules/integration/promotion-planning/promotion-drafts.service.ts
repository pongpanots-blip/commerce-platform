import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createPromotionDraftSchema, updatePromotionDraftSchema } from './promotion-planning.schema';
import { observationHash, PromotionInputsService } from './promotion-inputs.service';
type Row = Record<string, unknown>;
const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v);
const receipt = (r: Row) => ({ id: String(r.id), revision: Number(r.revision), status: 'draft' as const, saved: true, persisted: true,
  activationAllowed: false, operationalWrites: false, scenario: r.scenario, inputs: r.evidence, preview: r.preview, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });
const COLS = 'id, revision, scenario, evidence, preview, created_at, updated_at';
@Injectable()
export class PromotionDraftsService {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly inputs: PromotionInputsService) {}
  private actor(actor: string) { if (typeof actor !== 'string' || !actor || actor.length > 128) throw new BadRequestException('Invalid staff identity'); }
  private async available<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (e) { if (e instanceof HttpException) throw e; throw new ServiceUnavailableException('Draft storage unavailable. Reconcile the request ID before retrying.'); }
  }
  async create(raw: unknown, actor: string) { return this.save(createPromotionDraftSchema.parse(raw), actor); }
  async update(id: string, raw: unknown, actor: string) { return this.save(updatePromotionDraftSchema.parse(raw), actor, id); }
  private async save(input: ReturnType<typeof createPromotionDraftSchema.parse> & { revision?: number }, actor: string, id?: string) {
    this.actor(actor); const hash = observationHash({ operation: id ? 'update' : 'create', id: id ?? null, ...input });
    return this.available(() => this.db.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`promotion-draft:${actor}:${input.requestId}`]);
      const [previous]: Row[] = await m.query('SELECT request_hash, receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2', [actor, input.requestId]);
      if (previous) {
        if (previous.request_hash !== hash) throw new ConflictException('Request ID was used with a different operation or scenario');
        return { ...(previous.receipt as ReturnType<typeof receipt>), replayed: true };
      }
      if (id) {
        const [current]: Row[] = await m.query("SELECT revision FROM commerce_promotion_drafts WHERE id=$1 AND actor_id=$2 AND (scenario->>'kind') IS NULL FOR UPDATE", [id, actor]);
        if (!current) throw new NotFoundException('Draft not found');
        if (Number(current.revision) !== input.revision) throw new ConflictException('Draft changed. Reload before saving.');
      }
      const captured = await this.inputs.preview(input.scenario);
      const values = [JSON.stringify(captured.scenario), JSON.stringify(captured.inputs), JSON.stringify(captured.preview)];
      let saved: Row | undefined;
      if (id) {
        // TypeORM's PostgreSQL UPDATE RETURNING resolves to [records, affectedCount], unlike INSERT.
        const [records]: [Row[], number] = await m.query(`UPDATE commerce_promotion_drafts SET scenario=$3,evidence=$4,preview=$5,
          revision=revision+1,updated_at=now() WHERE id=$1 AND actor_id=$2 AND revision=$6 RETURNING ${COLS}`, [id, actor, ...values, input.revision]);
        saved = records[0];
      } else {
        [saved] = await m.query(`INSERT INTO commerce_promotion_drafts(id,actor_id,revision,scenario,evidence,preview) VALUES($1,$2,1,$3,$4,$5) RETURNING ${COLS}`, [randomUUID(), actor, ...values]);
      }
      if (!saved) throw new ConflictException('Draft changed. Reload before saving.');
      const savedReceipt = receipt(saved);
      await m.query('INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES($1,$2,$3,$4,$5)',
        [actor, input.requestId, hash, savedReceipt.id, JSON.stringify(savedReceipt)]);
      return { ...savedReceipt, replayed: false };
    }));
  }
  async get(id: string, actor: string) {
    this.actor(actor); return this.available(async () => {
      const [r]: Row[] = await this.db.query(`SELECT ${COLS} FROM commerce_promotion_drafts WHERE id=$1 AND actor_id=$2 AND (scenario->>'kind') IS NULL`, [id, actor]);
      if (!r) throw new NotFoundException('Draft not found'); return receipt(r);
    });
  }
  async request(id: string, actor: string) {
    this.actor(actor); return this.available(async () => {
      const [r]: Row[] = await this.db.query("SELECT receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2 AND (receipt->'scenario'->>'kind') IS NULL", [actor, id]);
      if (!r) throw new NotFoundException('Committed request not found'); return r.receipt;
    });
  }
  async list(actor: string, after?: string) {
    this.actor(actor); return this.available(async () => {
      const rows: Row[] = await this.db.query(`SELECT ${COLS} FROM commerce_promotion_drafts WHERE actor_id=$1 AND (scenario->>'kind') IS NULL AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 21`, [actor, after ?? null]);
      return { items: rows.slice(0, 20).map(receipt), next: rows.length > 20 ? String(rows[19].id) : null };
    });
  }
}
