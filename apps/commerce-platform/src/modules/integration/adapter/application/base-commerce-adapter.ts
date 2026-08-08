import { Logger } from '@nestjs/common';
import {
  AdapterContext,
  AdapterResult,
  CommerceAdapter,
  SyncResult,
} from '../domain/commerce-adapter.interface';
import { ReserveLineInput, ReserveLineResult } from '../../../commerce/reservation/domain/reservation-gateway.port';

/**
 * Shared plumbing for every connector: structured logging and a `withRetry`
 * envelope. Concrete connectors implement only the external-system calls and
 * inherit the cross-cutting behaviour. Deliberately free of any ERP specifics.
 */
export abstract class BaseCommerceAdapter implements CommerceAdapter {
  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly type: string;

  abstract syncCustomers(ctx: AdapterContext): Promise<SyncResult>;
  abstract syncProducts(ctx: AdapterContext): Promise<SyncResult>;
  abstract syncInventory(ctx: AdapterContext): Promise<SyncResult>;
  abstract syncPrices(ctx: AdapterContext): Promise<SyncResult>;
  abstract createOrder(order: unknown): Promise<AdapterResult>;
  abstract cancelOrder(ref: string): Promise<AdapterResult>;
  abstract updateOrder(order: unknown): Promise<AdapterResult>;

  /** Retry an operation with linear backoff; the last error is rethrown. */
  protected async withRetry<T>(
    op: () => Promise<T>,
    attempts = 3,
    delayMs = 100,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await op();
      } catch (error) {
        lastError = error;
        this.logger.warn(`${this.type}: attempt ${i + 1}/${attempts} failed`);
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
        }
      }
    }
    throw lastError;
  }

  async reserveStock(lines: ReserveLineInput[], _ctx: AdapterContext): Promise<ReserveLineResult[]> {
    return lines.map(() => ({
      ok: false, code: 'unsupported' as const,
      error: `${this.type} does not support reservations`,
    }));
  }

  async confirmReservation(_refs: string[], _ctx: AdapterContext): Promise<AdapterResult> {
    return { ok: false, error: `${this.type} does not support reservations` };
  }

  async releaseReservation(_refs: string[], _ctx: AdapterContext): Promise<AdapterResult> {
    return { ok: false, error: `${this.type} does not support reservations` };
  }
}
