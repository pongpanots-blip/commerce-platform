import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In, LessThan } from 'typeorm';
import { Order } from '../../order/infrastructure/order.entity';
import { OrderFulfillment } from '../../order/infrastructure/order-fulfillment.entity';
import { Payment } from '../../payment/infrastructure/payment.entity';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { ReservationFacade } from './reservation.facade';
import { ScheduledInterval } from '../../../../shared-kernel/infrastructure/scheduled-task';

const SWEEP_MS = Number(process.env.RESERVATION_SWEEP_MS || 60_000);

/**
 * TTL sweep (design §2 step 6, + Task 7 review addendum): held holds past
 * expiresAt are released at the ERP and the order expires. Covers both
 * orders still in 'pending_payment' (the normal abandoned-checkout case)
 * AND orders stuck in 'reserving' — that second case happens when the
 * process dies after ReservationFacade.reserve() persists held rows but
 * before the saga's setExpiry call; reserve() now stamps a provisional
 * expiresAt on every held row for exactly this reason, so those rows are
 * still reclaimed instead of leaking stock forever. Gateway failures leave
 * rows in 'reconcile' (facade behaviour) — visible in admin, never silently
 * stuck.
 *
 * Final-review addendum: before expiring a reclaimable order, its latest
 * payment is checked. A PAID payment means the sweep raced a confirm that
 * hasn't landed yet — skip entirely and log for reconciliation rather than
 * release stock that's already sold. A still-PENDING payment is voided
 * (conditional update) BEFORE the reservation release/order flip, so it can
 * never be marked paid afterwards against holds that no longer exist.
 */
@Injectable()
export class ReservationExpiryWorker {
  private readonly logger = new Logger(ReservationExpiryWorker.name);
  private running = false;

  constructor(
    private readonly reservations: ReservationRepository,
    private readonly dataSource: DataSource,
    private readonly facade: ReservationFacade,
  ) {}

  @ScheduledInterval('reservation-expiry', SWEEP_MS)
  async tick(): Promise<void> {
    if (this.running) return; // no overlapping sweeps
    this.running = true;
    try {
      await this.sweep();
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<void> {
    const expired = await this.reservations.orm.find({
      where: { status: 'held', expiresAt: LessThan(new Date()) },
    });
    const orderIds = [...new Set(expired.map((r) => r.orderId))];

    for (const orderId of orderIds) {
      const orders = this.dataSource.getRepository(Order);
      const order = await orders.findOne({ where: { id: orderId } });
      const reclaimable = order?.status === 'pending_payment' || order?.status === 'reserving';
      if (!reclaimable) continue; // payment won the race, or already terminal

      // Payment-path state discipline (final review, mirrors the conditional
      // pattern elsewhere in this cycle): check the order's latest payment
      // before touching anything. A PAID payment here means money was
      // collected but the order status didn't (yet) reflect it — expiring
      // stock out from under a paid order would be a correctness bug, so we
      // bail out loudly instead of guessing. A still-PENDING payment must be
      // voided first so it can never be marked paid later against holds that
      // are about to be released.
      const payments = this.dataSource.getRepository(Payment);
      const payment = await payments.findOne({ where: { orderId }, order: { createdAt: 'DESC' } });
      if (payment?.status === 'paid') {
        this.logger.error(
          `order ${orderId} has a PAID payment but expiry conditions matched — skipping, needs reconciliation`,
        );
        continue;
      }
      if (payment?.status === 'pending') {
        const voided = await payments.update({ id: payment.id, status: 'pending' }, { status: 'failed' });
        if (!voided.affected) {
          // Raced: the payment moved (e.g. to 'paid') between our read and
          // this write. Bail — the next sweep pass re-checks fresh state.
          this.logger.warn(`payment for order ${orderId} raced the expiry void, skipping this pass`);
          continue;
        }
      }

      this.logger.warn(`expiring unpaid/stuck order ${orderId} (was ${order?.status})`);
      // If payment already confirmed the reservation rows, this no-ops
      // harmlessly — the facade's transition only touches 'held' rows.
      await this.facade.releaseOrder(orderId, 'expired');

      // Atomic conditional flip: only expire the order if it is STILL in a
      // reclaimable status at write time. Without this, onPaymentPaid landing
      // between the read above and this write would get stomped to 'expired'
      // on a paid order.
      const res = await orders.update(
        { id: orderId, status: In(['pending_payment', 'reserving']) },
        { status: 'expired' },
      );
      if (!res.affected) {
        this.logger.warn(`payment raced expiry sweep for order ${orderId}, skipping`);
        continue;
      }
      // Defensive: a fulfillment row might not exist for every line on a
      // 'reserving' order that crashed very early — update() is a no-op
      // when nothing matches, which is fine here.
      await this.dataSource.getRepository(OrderFulfillment)
        .update({ orderId }, { status: 'expired' });
    }
  }
}
