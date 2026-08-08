import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { Order } from '../infrastructure/order.entity';
import { OrderLine } from '../infrastructure/order-line.entity';
import { OrderFulfillment } from '../infrastructure/order-fulfillment.entity';
import { Product } from '../../product/infrastructure/product.entity';
import { Payment } from '../../payment/infrastructure/payment.entity';
import { ReservationFacade } from '../../reservation/application/reservation.facade';
import { SettingsService } from '../../../core/settings/application/settings.service';
import { OrderConfirmed } from '../domain/events/order-confirmed.event';
import { routeLines } from './route-lines';

export interface CheckoutLineResult {
  orderLineId: string;
  status: string;           // held | failed
  failReason: string | null;
}
export interface CheckoutResult {
  orderId: string;
  status: string;           // pending_payment | failed
  paymentId: string | null;
  lines: CheckoutLineResult[];
}

/**
 * Orchestrated checkout saga (design §2). State lives on order + reservation
 * rows; compensation is explicit (release on any line failure / payment
 * failure); TTL stamps make abandoned checkouts self-healing (T9 sweep).
 */
@Injectable()
export class OrderCheckoutSaga {
  private readonly logger = new Logger(OrderCheckoutSaga.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly reservations: ReservationFacade,
    private readonly settings: SettingsService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  private get ttlMinutes(): number {
    return Number(process.env.RESERVATION_TTL_MINUTES || 30);
  }

  async checkout(orderId: string, idempotencyKey: string): Promise<CheckoutResult> {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');

    const orders = this.dataSource.getRepository(Order);
    const order = await orders.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (order.status !== 'draft') {
      if (order.idempotencyKey === idempotencyKey) return this.currentState(orderId, order);
      throw new ConflictException(`order ${orderId} already checked out`);
    }

    order.status = 'reserving';
    order.idempotencyKey = idempotencyKey;
    await orders.save(order);

    let results: Awaited<ReturnType<ReservationFacade['reserve']>>;
    try {
      const lines = await this.dataSource.getRepository(OrderLine).find({ where: { orderId } });
      if (!lines.length) throw new BadRequestException('order has no lines');

      const lineProductIds = [...new Set(lines.map((l) => l.productId))];
      const productRows = await this.dataSource.getRepository(Product).find({ where: { id: In(lineProductIds) } });
      const products = new Map(productRows.map((p) => [p.id, p]));
      const defaultLead =
        (await this.settings.get<number>('commerce', 'default_lead_time_days', order.organizationId)) ??
        Number(process.env.TO_ORDER_DEFAULT_LEAD_TIME_DAYS || 7);

      const routed = routeLines(lines, products, defaultLead, new Date());

      const fulfillRepo = this.dataSource.getRepository(OrderFulfillment);
      await fulfillRepo.save(routed.map((r) => fulfillRepo.create({
        orderId, orderLineId: r.orderLineId, source: 'erp', mode: r.mode, status: 'pending',
      })));

      results = await this.reservations.reserve(routed);
    } catch (err) {
      // Wedge guard (final review): an order flipped to 'reserving' above with
      // no compensation path if anything in this block throws (unknown
      // product, routing bug, gateway exception) — the TTL sweep only
      // reclaims pending_payment/reserving orders whose HELD rows are past
      // expiresAt, so an order that never got far enough to create rows
      // would be stuck in 'reserving' forever. Flip to 'failed' directly
      // (not via reservations, which may not have run) and best-effort
      // release any holds this pass DID manage to create before rethrowing
      // so the caller still sees the original error.
      await orders.update({ id: orderId }, { status: 'failed' });
      try {
        await this.reservations.releaseOrder(orderId, 'released');
      } catch (releaseErr) {
        this.logger.error(`best-effort release after checkout wedge failed for order ${orderId}: ${releaseErr}`);
      }
      throw err;
    }
    const failed = results.filter((r) => r.status === 'failed');

    if (failed.length) {
      await this.reservations.releaseOrder(orderId, 'released');
      // held lines were compensated → released; genuinely failed lines → failed
      await this.setFulfillmentStatuses(orderId, results, 'released', 'failed');
      order.status = 'failed';
      await orders.save(order);
      return this.toResult(order, null, results);
    }

    await this.setFulfillmentStatuses(orderId, results, 'reserved', 'failed');
    await this.reservations.setExpiry(orderId, new Date(Date.now() + this.ttlMinutes * 60_000));

    const payments = this.dataSource.getRepository(Payment);
    const payment = await payments.save(payments.create({
      orderId, status: 'pending', amount: order.total, currency: order.currency, method: 'stub',
    }));

    order.status = 'pending_payment';
    await orders.save(order);
    return this.toResult(order, payment.id, results);
  }

  /**
   * Ordering choice (final review, mirrors the atomic-conditional pattern in
   * payment.service.ts / reservation-expiry.worker.ts): the order flip is
   * checked-and-written FIRST, inside the tx, conditioned on the order still
   * being 'pending_payment'. Only if that flip actually wins do we touch
   * fulfillments/publish (same tx) and then call facade.confirmOrder AFTER
   * commit. This closes the race where a payment lands after the TTL sweep
   * already expired the order — previously confirmOrder ran unconditionally
   * up front, which would have resurrected reservations on a dead order.
   */
  async onPaymentPaid(orderId: string): Promise<void> {
    let flipped = false;
    await this.dataSource.transaction(async (manager) => {
      const orders = manager.getRepository(Order);
      const res = await orders.update({ id: orderId, status: 'pending_payment' }, { status: 'confirmed' });
      if (!res.affected) {
        this.logger.error(`payment landed on order ${orderId} not in pending_payment — reconcile`);
        return;
      }
      flipped = true;
      await manager.getRepository(OrderFulfillment).update({ orderId }, { status: 'confirmed' });
      await this.eventBus.publish(new OrderConfirmed(orderId, { id: orderId }), manager);
    });
    if (flipped) {
      await this.reservations.confirmOrder(orderId);
    }
  }

  /** Same conditional-flip-first ordering as onPaymentPaid, see comment there. */
  async onPaymentFailed(orderId: string): Promise<void> {
    let flipped = false;
    await this.dataSource.transaction(async (manager) => {
      const orders = manager.getRepository(Order);
      const res = await orders.update({ id: orderId, status: 'pending_payment' }, { status: 'failed' });
      if (!res.affected) {
        this.logger.error(`payment failure landed on order ${orderId} not in pending_payment — reconcile`);
        return;
      }
      flipped = true;
      await manager.getRepository(OrderFulfillment).update({ orderId }, { status: 'released' });
    });
    if (flipped) {
      await this.reservations.releaseOrder(orderId, 'released');
    }
  }

  private async setFulfillmentStatuses(
    orderId: string,
    results: { orderLineId: string; status: string }[],
    heldTo: string,
    failedTo: string,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(OrderFulfillment);
    for (const r of results) {
      await repo.update(
        { orderId, orderLineId: r.orderLineId },
        { status: r.status === 'held' ? heldTo : failedTo,
          reservationId: (r as { id?: string }).id ?? null },
      );
    }
  }

  private async currentState(orderId: string, order: Order): Promise<CheckoutResult> {
    const rows = await this.dataSource
      .getRepository(OrderFulfillment).find({ where: { orderId } });
    return {
      orderId, status: order.status,
      paymentId: null,
      lines: rows.map((f) => ({ orderLineId: f.orderLineId, status: f.status, failReason: null })),
    };
  }

  private toResult(
    order: Order, paymentId: string | null,
    results: { orderLineId: string; status: string; failReason?: string | null }[],
  ): CheckoutResult {
    return {
      orderId: order.id, status: order.status, paymentId,
      lines: results.map((r) => ({
        orderLineId: r.orderLineId, status: r.status, failReason: r.failReason ?? null,
      })),
    };
  }
}
