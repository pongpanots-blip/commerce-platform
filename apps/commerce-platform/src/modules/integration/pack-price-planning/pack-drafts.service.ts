import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createPackSchema, packReceiptSchema, updatePackSchema, type PackReceipt } from './pack-price';
import { PackInputsService } from './pack-inputs.service';

type Row = Record<string, unknown>;
const COLS = 'id, revision, scenario, evidence, preview, created_at, updated_at';
const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v);
const receipt = (r: Row) => packReceiptSchema.parse({ id: r.id, revision: Number(r.revision), status: 'draft', saved: true, persisted: true,
  activationAllowed: false, operationalWrites: false, scenario: r.scenario, inputs: r.evidence, preview: r.preview, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) });

/** Reuses the existing private draft tables and durable request protocol, partitioned by scenario kind. */
@Injectable()
export class PackDraftsService {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly inputs: PackInputsService) {}
  private actor(value: string) { if (!value || typeof value !== 'string' || value.length > 128) throw new BadRequestException('Invalid staff identity'); }
  private async available<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (e) { if (e instanceof HttpException) throw e; throw new ServiceUnavailableException('Planning draft storage unavailable. Check the original request before retrying.'); }
  }
  create(raw: unknown, actor: string) { return this.save(createPackSchema.parse(raw), actor); }
  update(id: string, raw: unknown, actor: string) { return this.save(updatePackSchema.parse(raw), actor, id); }
  private async save(input: ReturnType<typeof createPackSchema.parse> & { revision?: number }, actor: string, id?: string) {
    this.actor(actor);
    const hash = createHash('sha256').update(JSON.stringify({ operation: id ? 'update' : 'create', id: id ?? null, ...input })).digest('hex');
    return this.available(() => this.db.transaction(async m => {
      // Same lock key as the existing protocol: a cross-kind request collision cannot race its unique key.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`promotion-draft:${actor}:${input.requestId}`]);
      const [previous]: Row[] = await m.query('SELECT request_hash, receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2', [actor, input.requestId]);
      if (previous) {
        if (previous.request_hash !== hash) throw new ConflictException('Request ID already identifies a different planning operation');
        return { ...packReceiptSchema.parse(previous.receipt), replayed: true };
      }
      if (id) {
        const [current]: Row[] = await m.query("SELECT revision FROM commerce_promotion_drafts WHERE id=$1 AND actor_id=$2 AND scenario->>'kind'='pack_price' FOR UPDATE", [id, actor]);
        if (!current) throw new NotFoundException('Pack planning draft not found');
        if (Number(current.revision) !== input.revision) throw new ConflictException('Draft changed. Reload before saving.');
      }
      // Recapture existing sources inside the save attempt; stale evidence is never silently substituted.
      const captured = await this.inputs.preview(input.scenario);
      const values = [JSON.stringify(captured.scenario), JSON.stringify(captured.inputs), JSON.stringify(captured.preview)];
      let row: Row | undefined;
      if (id) {
        const [records]: [Row[], number] = await m.query(`UPDATE commerce_promotion_drafts SET scenario=$3,evidence=$4,preview=$5,revision=revision+1,updated_at=now()
          WHERE id=$1 AND actor_id=$2 AND revision=$6 AND scenario->>'kind'='pack_price' RETURNING ${COLS}`, [id, actor, ...values, input.revision]);
        row = records[0];
      } else [row] = await m.query(`INSERT INTO commerce_promotion_drafts(id,actor_id,revision,scenario,evidence,preview) VALUES($1,$2,1,$3,$4,$5) RETURNING ${COLS}`, [randomUUID(), actor, ...values]);
      if (!row) throw new ConflictException('Draft changed. Reload before saving.');
      const saved = receipt(row);
      await m.query('INSERT INTO commerce_promotion_draft_requests(actor_id,request_id,request_hash,draft_id,receipt) VALUES($1,$2,$3,$4,$5)', [actor, input.requestId, hash, saved.id, JSON.stringify(saved)]);
      return { ...saved, replayed: false };
    }));
  }
  async get(id: string, actor: string) {
    this.actor(actor); return this.available(async () => {
      const [row]: Row[] = await this.db.query(`SELECT ${COLS} FROM commerce_promotion_drafts WHERE id=$1 AND actor_id=$2 AND scenario->>'kind'='pack_price'`, [id, actor]);
      if (!row) throw new NotFoundException('Pack planning draft not found'); return receipt(row);
    });
  }
  async request(id: string, actor: string): Promise<PackReceipt> {
    this.actor(actor); return this.available(async () => {
      const [row]: Row[] = await this.db.query("SELECT receipt FROM commerce_promotion_draft_requests WHERE actor_id=$1 AND request_id=$2 AND receipt->'scenario'->>'kind'='pack_price'", [actor, id]);
      if (!row) throw new NotFoundException('Committed pack planning request not found'); return packReceiptSchema.parse(row.receipt);
    });
  }
  async list(actor: string, after?: string) {
    this.actor(actor); return this.available(async () => {
      const rows: Row[] = await this.db.query(`SELECT ${COLS} FROM commerce_promotion_drafts WHERE actor_id=$1 AND scenario->>'kind'='pack_price' AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 21`, [actor, after ?? null]);
      return { items: rows.slice(0, 20).map(receipt), next: rows.length > 20 ? String(rows[19].id) : null };
    });
  }
}
