import {
  ReserveLineInput,
  ReserveLineResult,
} from '../../../commerce/reservation/domain/reservation-gateway.port';

/**
 * Canonical Commerce Adapter port. EVERY connector (Jagota, SAP, Shopify,
 * WooCommerce, POS, future ERPs) implements this same interface, so business
 * logic never depends on a specific external system.
 *
 * No ERP-specific method belongs here — only the canonical operations.
 */
export interface AdapterContext {
  integrationId: string;
  [key: string]: unknown;
}

export interface SyncResult {
  processed: number;
  failed: number;
}

export interface AdapterResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

export interface CommerceAdapter {
  syncCustomers(ctx: AdapterContext): Promise<SyncResult>;
  syncProducts(ctx: AdapterContext): Promise<SyncResult>;
  syncInventory(ctx: AdapterContext): Promise<SyncResult>;
  syncPrices(ctx: AdapterContext): Promise<SyncResult>;
  createOrder(order: unknown): Promise<AdapterResult>;
  cancelOrder(ref: string): Promise<AdapterResult>;
  updateOrder(order: unknown): Promise<AdapterResult>;

  /** Take synchronous holds. MUST be idempotent on idempotencyKey. */
  reserveStock(lines: ReserveLineInput[], ctx: AdapterContext): Promise<ReserveLineResult[]>;
  confirmReservation(externalRefs: string[], ctx: AdapterContext): Promise<AdapterResult>;
  releaseReservation(externalRefs: string[], ctx: AdapterContext): Promise<AdapterResult>;
}
