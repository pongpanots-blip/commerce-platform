import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Payment } from '../infrastructure/payment.entity';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { OrderCheckoutSaga } from '../../order/application/order-checkout.saga';

/**
 * Simulated payment gateway (design decision: real PSP is a later phase behind
 * this same surface). pay/fail are the ONLY transitions and only from pending.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly repo: PaymentRepository,
    private readonly saga: OrderCheckoutSaga,
  ) {}

  list(orderId?: string) {
    return this.repo.findMany({
      page: 1, pageSize: 50,
      where: orderId ? { orderId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async markPaid(id: string): Promise<Payment> {
    const payment = await this.transition(id, 'paid');
    await this.saga.onPaymentPaid(payment.orderId);
    return payment;
  }

  async markFailed(id: string): Promise<Payment> {
    const payment = await this.transition(id, 'failed');
    await this.saga.onPaymentFailed(payment.orderId);
    return payment;
  }

  /**
   * Atomic conditional update (mirrors reservation-expiry.worker.ts): the
   * pending → to flip and the "is it still pending" check happen in one
   * statement, closing the findOne-then-save TOCTOU window where two
   * concurrent requests could both read 'pending' and both write.
   */
  private async transition(id: string, to: 'paid' | 'failed'): Promise<Payment> {
    const result = await this.repo.orm.update({ id, status: 'pending' }, { status: to });
    if (!result.affected) {
      const existing = await this.repo.orm.findOne({ where: { id } });
      if (!existing) throw new NotFoundException(`Payment ${id} not found`);
      throw new ConflictException(`payment ${id} is ${existing.status}, only pending can transition`);
    }
    const updated = await this.repo.orm.findOne({ where: { id } });
    if (!updated) throw new NotFoundException(`Payment ${id} not found`);
    return updated;
  }
}
