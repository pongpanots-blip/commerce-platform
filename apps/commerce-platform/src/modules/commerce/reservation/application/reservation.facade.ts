import { Inject, Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';
import {
  RESERVATION_GATEWAY, ReservationGateway,
} from '../domain/reservation-gateway.port';
import { Reservation } from '../infrastructure/reservation.entity';
import { ReservationRepository } from '../infrastructure/reservation.repository';

export interface ReserveRequestLine {
  orderId: string;
  orderLineId: string;
  productId: string;
  sku: string;
  qty: number;
  mode: 'on_hand' | 'to_order';
  promisedDate: string | null;
}

/**
 * Reservation authority. ALL holds are decided and persisted here — checkout,
 * expiry sweep, and manual admin release all go through this facade so there
 * is exactly one write path for stock correctness.
 */
@Injectable()
export class ReservationFacade {
  private readonly logger = new Logger(ReservationFacade.name);

  constructor(
    private readonly repo: ReservationRepository,
    @Inject(RESERVATION_GATEWAY) private readonly gateway: ReservationGateway,
  ) {}

  private get ttlMinutes(): number {
    return Number(process.env.RESERVATION_TTL_MINUTES || 30);
  }

  async reserve(lines: ReserveRequestLine[]): Promise<Reservation[]> {
    const onHand = lines.filter((l) => l.mode === 'on_hand');
    const results = new Map<string, { ok: boolean; externalRef?: string; code?: string; error?: string }>();

    if (onHand.length) {
      const gwResults = await this.gateway.reserve(
        onHand.map((l) => ({ sku: l.sku, qty: l.qty, idempotencyKey: this.keyFor(l) })),
      );
      onHand.forEach((l, i) => results.set(l.orderLineId, gwResults[i]));
    }
    const integrationId = onHand.length ? await this.gateway.integrationId() : null;
    // Provisional TTL, stamped at reserve-time (not by the saga). Closes the
    // crash window where the process dies after this write but before the
    // saga's later setExpiry call — the sweep can still reclaim these rows
    // instead of leaking stock on a null-expiresAt held row.
    const provisionalExpiry = new Date(Date.now() + this.ttlMinutes * 60_000);

    const saved: Reservation[] = [];
    for (const line of lines) {
      const gw = results.get(line.orderLineId);
      const held = line.mode === 'to_order' || gw?.ok === true;
      saved.push(await this.repo.save({
        orderId: line.orderId,
        orderLineId: line.orderLineId,
        productId: line.productId,
        sku: line.sku,
        qty: String(line.qty),
        mode: line.mode,
        status: held ? 'held' : 'failed',
        externalRef: gw?.externalRef ?? null,
        integrationId: line.mode === 'on_hand' ? integrationId : null,
        idempotencyKey: this.keyFor(line),
        promisedDate: line.promisedDate,
        failReason: held ? null : `${gw?.code ?? 'error'}: ${gw?.error ?? 'unknown'}`,
        expiresAt: held ? provisionalExpiry : null,
      }));
    }
    return saved;
  }

  async confirmOrder(orderId: string): Promise<void> {
    await this.transition(orderId, 'held', 'confirmed', (refs) => this.gateway.confirm(refs));
  }

  async releaseOrder(orderId: string, to: 'released' | 'expired'): Promise<void> {
    // Also retry rows left in 'reconcile' (final review): a prior release/
    // expire whose gateway call failed parks rows there instead of flipping
    // them, so the next release call for the same order (a later sweep pass,
    // or a repeat manual admin release) retries them too — a reconcile row
    // is never silently stuck. Confirm stays held-only above: a reconcile
    // row can only ever be released, never confirmed.
    await this.transition(orderId, In(['held', 'reconcile']), to, (refs) => this.gateway.release(refs));
  }

  async setExpiry(orderId: string, expiresAt: Date): Promise<void> {
    await this.repo.update({ orderId, status: 'held' }, { expiresAt });
  }

  private async transition(
    orderId: string,
    from: Reservation['status'] | ReturnType<typeof In>,
    to: 'confirmed' | 'released' | 'expired',
    gatewayOp: (refs: string[]) => Promise<{ ok: boolean; error?: string }>,
  ): Promise<void> {
    const held = await this.repo.find({ orderId, status: from });
    if (!held.length) return;

    const refs = held.filter((r) => r.mode === 'on_hand' && r.externalRef).map((r) => r.externalRef as string);
    let erpOk = true;
    if (refs.length) {
      const res = await gatewayOp(refs);
      erpOk = res.ok;
      if (!erpOk) this.logger.error(`gateway ${to} failed for order ${orderId}: ${res.error}`);
    }

    for (const row of held) {
      const needsErp = row.mode === 'on_hand' && row.externalRef;
      row.status = needsErp && !erpOk ? 'reconcile' : to;
      await this.repo.save(row);
    }
  }

  private keyFor(line: { orderId: string; orderLineId: string }): string {
    return `${line.orderId}:${line.orderLineId}`;
  }
}
