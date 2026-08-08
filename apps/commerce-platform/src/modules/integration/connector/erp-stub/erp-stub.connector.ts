import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BaseCommerceAdapter } from '../../adapter/application/base-commerce-adapter';
import {
  AdapterContext, AdapterResult, SyncResult,
} from '../../adapter/domain/commerce-adapter.interface';
import {
  ReserveLineInput, ReserveLineResult,
} from '../../../commerce/reservation/domain/reservation-gateway.port';
import { ErpStubReservation } from './erp-stub-reservation.entity';

/**
 * Simulated Oracle ERP. The atomic UPDATE ... WHERE qty >= n makes the
 * last-piece race REAL: two concurrent reserves for the final unit — exactly
 * one row is affected, exactly one caller wins. Holds are idempotent on
 * idempotencyKey (retry-safe). Config knobs: latencyMs, failSkus.
 */
@Injectable()
export class ErpStubConnector extends BaseCommerceAdapter {
  readonly type = 'erp-stub';

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async syncCustomers(_ctx: AdapterContext): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async syncProducts(_ctx: AdapterContext): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async syncInventory(_ctx: AdapterContext): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async syncPrices(_ctx: AdapterContext): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
  async createOrder(_order: unknown): Promise<AdapterResult> { return { ok: true }; }
  async cancelOrder(_ref: string): Promise<AdapterResult> { return { ok: true }; }
  async updateOrder(_order: unknown): Promise<AdapterResult> { return { ok: true }; }

  override async reserveStock(
    lines: ReserveLineInput[], ctx: AdapterContext,
  ): Promise<ReserveLineResult[]> {
    const cfg = (ctx.config ?? {}) as { latencyMs?: number; failSkus?: string[]; failureRate?: number };
    if (cfg.latencyMs) await new Promise((r) => setTimeout(r, cfg.latencyMs));

    const results: ReserveLineResult[] = [];
    for (const line of lines) {
      if (cfg.failSkus?.includes(line.sku) || (cfg.failureRate && Math.random() < cfg.failureRate)) {
        results.push({ ok: false, code: 'erp_unavailable', error: 'stub: forced failure' });
        continue;
      }
      try {
        results.push(await this.reserveOne(line));
      } catch (error) {
        // Per-line isolation: one failed line must not abort the batch — the
        // contract is one result per input line, same order.
        results.push(await this.recoverLine(line, error));
      }
    }
    return results;
  }

  /**
   * A concurrent duplicate-idempotencyKey submission can slip past the
   * findOne check in both callers; the loser's INSERT then hits the unique
   * constraint and its transaction rolls back (no double decrement). Converge
   * by re-reading the winner's row; anything else is a per-line error.
   */
  private async recoverLine(line: ReserveLineInput, error: unknown): Promise<ReserveLineResult> {
    try {
      const existing = await this.dataSource
        .getRepository(ErpStubReservation)
        .findOne({ where: { idempotencyKey: line.idempotencyKey } });
      if (existing && existing.status !== 'released') {
        return { ok: true, externalRef: existing.id };
      }
    } catch {
      // fall through to the per-line error below
    }
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`${this.type}: reserve failed for ${line.sku} (${line.idempotencyKey}): ${message}`);
    return { ok: false, code: 'error', error: message };
  }

  private reserveOne(line: ReserveLineInput): Promise<ReserveLineResult> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const repo = manager.getRepository(ErpStubReservation);

      const existing = await repo.findOne({ where: { idempotencyKey: line.idempotencyKey } });
      if (existing) {
        return existing.status === 'released'
          ? { ok: false, code: 'error' as const, error: 'hold already released' }
          : { ok: true, externalRef: existing.id };
      }

      const [, affected] = (await manager.query(
        'UPDATE erp_stub_stock SET qty = qty - $1 WHERE sku = $2 AND qty >= $1',
        [line.qty, line.sku],
      )) as [unknown, number];

      if (!affected) {
        return { ok: false, code: 'insufficient_stock' as const, error: `no stock for ${line.sku}` };
      }

      const saved = await repo.save(repo.create({
        idempotencyKey: line.idempotencyKey,
        sku: line.sku,
        qty: line.qty,
        status: 'held',
      }));
      return { ok: true, externalRef: saved.id };
    });
  }

  override async confirmReservation(refs: string[], _ctx: AdapterContext): Promise<AdapterResult> {
    await this.dataSource.getRepository(ErpStubReservation)
      .createQueryBuilder().update()
      .set({ status: 'confirmed' })
      .where('id IN (:...refs) AND status = :held', { refs, held: 'held' })
      .execute();
    return { ok: true };
  }

  override async releaseReservation(refs: string[], _ctx: AdapterContext): Promise<AdapterResult> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ErpStubReservation);
      const rows = await repo.find({ where: refs.map((id) => ({ id, status: 'held' })) });
      for (const row of rows) {
        await manager.query(
          'UPDATE erp_stub_stock SET qty = qty + $1 WHERE sku = $2',
          [row.qty, row.sku],
        );
        row.status = 'released';
        await repo.save(row);
      }
      return { ok: true };
    });
  }
}
