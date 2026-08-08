import { Injectable } from '@nestjs/common';
import { BaseCommerceAdapter } from '../../adapter/application/base-commerce-adapter';
import {
  AdapterContext, AdapterResult, SyncResult,
} from '../../adapter/domain/commerce-adapter.interface';
import {
  ReserveLineInput, ReserveLineResult,
} from '../../../commerce/reservation/domain/reservation-gateway.port';
import { ErpClientConfig, ErpHttpClient } from './erp-http.client';

/**
 * REAL ERP connector (type 'erp'). All wire specifics live in ErpHttpClient;
 * this class only maps canonical port types ↔ client payloads. While the
 * integration's config.liveMode is off, the client returns mocks — so this
 * connector is safe to register today and flip live later via config alone.
 * It does NOT replace erp-stub as reservation authority unless
 * COMMERCE_RESERVATION_CONNECTOR=erp is set explicitly.
 */
@Injectable()
export class ErpConnector extends BaseCommerceAdapter {
  readonly type = 'erp';

  constructor(private readonly client: ErpHttpClient) {
    super();
  }

  private cfg(ctx: AdapterContext): ErpClientConfig {
    return (ctx.config ?? {}) as ErpClientConfig;
  }

  override async reserveStock(lines: ReserveLineInput[], ctx: AdapterContext): Promise<ReserveLineResult[]> {
    const results = await this.client.reserve(
      lines.map((l) => ({ sku: l.sku, qty: l.qty, idempotencyKey: l.idempotencyKey })),
      this.cfg(ctx),
    );
    return results.map((r) =>
      r.ok
        ? { ok: true, externalRef: r.reservationRef }
        : { ok: false, code: 'insufficient_stock' as const, error: r.reason },
    );
  }

  override async confirmReservation(refs: string[], ctx: AdapterContext): Promise<AdapterResult> {
    const res = await this.client.confirmReservations(refs, this.cfg(ctx));
    return { ok: res.ok, error: res.error };
  }

  override async releaseReservation(refs: string[], ctx: AdapterContext): Promise<AdapterResult> {
    const res = await this.client.releaseReservations(refs, this.cfg(ctx));
    return { ok: res.ok, error: res.error };
  }

  async createOrder(_order: unknown): Promise<AdapterResult> {
    // Full order push wiring lands with the OMS→ERP dispatch cycle; contract
    // lives in ErpHttpClient.createOrder. Not called from any live path yet —
    // return honest failure instead of a silent fake success (final review).
    return { ok: false, error: 'erp order push not wired (OMS dispatch cycle)' };
  }

  async cancelOrder(_ref: string): Promise<AdapterResult> {
    return { ok: false, error: 'erp order push not wired (OMS dispatch cycle)' };
  }

  async updateOrder(_order: unknown): Promise<AdapterResult> {
    return { ok: false, error: 'erp order push not wired (OMS dispatch cycle)' };
  }

  async syncCustomers(_ctx: AdapterContext): Promise<SyncResult> { return { processed: 0, failed: 0 }; }

  async syncProducts(ctx: AdapterContext): Promise<SyncResult> {
    const rows = await this.client.fetchProducts(null, this.cfg(ctx));
    return { processed: rows.length, failed: 0 };
  }

  async syncInventory(ctx: AdapterContext): Promise<SyncResult> {
    const rows = await this.client.fetchStock([], this.cfg(ctx));
    return { processed: rows.length, failed: 0 };
  }

  async syncPrices(_ctx: AdapterContext): Promise<SyncResult> { return { processed: 0, failed: 0 }; }
}
