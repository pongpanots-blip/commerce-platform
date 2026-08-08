/**
 * Reservation gateway PORT. Lives in commerce scope so the facade can depend on
 * it; the implementation lives in integration scope (allowed direction) and is
 * bound to RESERVATION_GATEWAY by a @Global() module in app.module.ts.
 */
export const RESERVATION_GATEWAY = Symbol('RESERVATION_GATEWAY');

export interface ReserveLineInput {
  sku: string;
  qty: number;
  idempotencyKey: string;
}

export type ReserveFailCode = 'insufficient_stock' | 'erp_unavailable' | 'unsupported' | 'error';

export interface ReserveLineResult {
  ok: boolean;
  externalRef?: string;
  code?: ReserveFailCode;
  error?: string;
}

export interface GatewayResult {
  ok: boolean;
  error?: string;
}

export interface ReservationGateway {
  /** Synchronous ERP hold, one result per input line, same order. */
  reserve(lines: ReserveLineInput[]): Promise<ReserveLineResult[]>;
  confirm(externalRefs: string[]): Promise<GatewayResult>;
  release(externalRefs: string[]): Promise<GatewayResult>;
  /** integrationId of the connector that will take the holds (for audit columns). */
  integrationId(): Promise<string | null>;
}
