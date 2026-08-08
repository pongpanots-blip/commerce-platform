import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseCrudService } from '../../../../shared-kernel/application/base-crud.service';
import { Order } from '../infrastructure/order.entity';
import { OrderLine } from '../infrastructure/order-line.entity';
import { OrderFulfillment } from '../infrastructure/order-fulfillment.entity';
import { OrderRepository } from '../infrastructure/order.repository';
import { Payment } from '../../payment/infrastructure/payment.entity';
import { Reservation } from '../../reservation/infrastructure/reservation.entity';

@Injectable()
export class OrderService extends BaseCrudService<Order> {
  constructor(
    repo: OrderRepository,
    private readonly dataSource: DataSource,
  ) {
    super(repo);
  }

  protected get entityName(): string {
    return 'Order';
  }

  async createWithLines(dto: {
    customerId: string; currency?: string;
    lines: { productId: string; qty: number; unitPrice: number }[];
  }): Promise<Order> {
    if (!dto.lines?.length) throw new BadRequestException('order needs at least one line');

    return this.dataSource.transaction(async (manager) => {
      const orders = manager.getRepository(Order);
      const lines = manager.getRepository(OrderLine);

      // Round each line first, then total the rounded lines — the order header
      // must equal the sum of its line items (financial integrity). Summing in
      // integer cents avoids float drift over the already-rounded values.
      const lineTotals = dto.lines.map((l) => (l.qty * l.unitPrice).toFixed(2));
      const totalCents = lineTotals.reduce((sum, t) => sum + Math.round(Number(t) * 100), 0);

      const order = await orders.save(orders.create({
        customerId: dto.customerId,
        currency: dto.currency ?? 'THB',
        status: 'draft',
        total: (totalCents / 100).toFixed(2),
      }));

      await lines.save(dto.lines.map((l, i) => lines.create({
        orderId: order.id,
        productId: l.productId,
        qty: String(l.qty),
        unitPrice: String(l.unitPrice),
        lineTotal: lineTotals[i],
      })));

      return order;
    });
  }

  /** Lookup for the storefront checkout idempotent-retry path (see storefront-checkout.service.ts). */
  findByIdempotencyKey(key: string): Promise<Order | null> {
    return this.dataSource.getRepository(Order).findOne({ where: { idempotencyKey: key } });
  }

  async getFull(orderId: string) {
    const order = await this.findOne(orderId);
    const [lines, fulfillments, reservations, payment] = await Promise.all([
      this.dataSource.getRepository(OrderLine).find({ where: { orderId } }),
      this.dataSource.getRepository(OrderFulfillment).find({ where: { orderId } }),
      this.dataSource.getRepository(Reservation).find({ where: { orderId } }),
      this.dataSource.getRepository(Payment).findOne({ where: { orderId }, order: { createdAt: 'DESC' } }),
    ]);
    return { order, lines, fulfillments, reservations, payment };
  }
}
