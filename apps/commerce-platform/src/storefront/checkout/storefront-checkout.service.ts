import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderService } from '../../modules/commerce/order/application/order.service';
import { OrderCheckoutSaga, CheckoutResult } from '../../modules/commerce/order/application/order-checkout.saga';
import { PaymentService } from '../../modules/commerce/payment/application/payment.service';
import { StorefrontCheckoutDto } from './dto/storefront-checkout.dto';

/** Thin gateway: create order + run saga in one request; report payment result. */
@Injectable()
export class StorefrontCheckoutService {
  constructor(
    private readonly orders: OrderService,
    private readonly saga: OrderCheckoutSaga,
    private readonly payments: PaymentService,
  ) {}

  async checkout(dto: StorefrontCheckoutDto, idempotencyKey: string): Promise<CheckoutResult> {
    // Reject before persisting anything: the saga also 400s on a missing key,
    // but by then the draft order + lines are already saved (orphaned rows —
    // drafts sit outside the TTL sweep). Saga check stays as defense in depth.
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');

    // josh retry with the same key: replay against the order that key already
    // created instead of inserting a second draft (which would 500 on the
    // orders.idempotency_key unique constraint). The saga's own replay path
    // (order.idempotencyKey === key) then returns the current state.
    const existing = await this.orders.findByIdempotencyKey(idempotencyKey);
    if (existing) return this.saga.checkout(existing.id, idempotencyKey);

    const order = await this.orders.createWithLines({
      customerId: dto.customerId, currency: dto.currency, lines: dto.lines,
    });
    return this.saga.checkout(order.id, idempotencyKey);
  }

  async paymentResult(orderId: string, result: 'paid' | 'failed') {
    const { items } = await this.payments.list(orderId);
    const pending = items.find((p) => p.status === 'pending');
    if (!pending) throw new NotFoundException(`order ${orderId} has no pending payment`);
    return result === 'paid'
      ? this.payments.markPaid(pending.id)
      : this.payments.markFailed(pending.id);
  }
}
