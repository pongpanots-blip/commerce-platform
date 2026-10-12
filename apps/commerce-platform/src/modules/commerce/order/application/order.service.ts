import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseCrudService } from '../../../../shared-kernel/application/base-crud.service';
import { Paginated } from '../../../../shared-kernel/interfaces/repository.interface';
import { escapeLike } from '../../../../shared-kernel/infrastructure/typeorm-base.repository';
import { Customer } from '../../customer/infrastructure/customer.entity';
import { Order } from '../infrastructure/order.entity';
import { OrderLine } from '../infrastructure/order-line.entity';
import { OrderFulfillment } from '../infrastructure/order-fulfillment.entity';
import { OrderRepository } from '../infrastructure/order.repository';
import { Payment } from '../../payment/infrastructure/payment.entity';
import { Reservation } from '../../reservation/infrastructure/reservation.entity';

export type OrderListRow = Order & { customerName: string | null; customerCode: string | null };

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

  /**
   * Admin order list: newest first, with the customer's name, filtered by status / customer and a
   * search over the order code, order id and customer name/code.
   */
  async listForAdmin(query: { page?: number; pageSize?: number; search?: string; status?: string; customerId?: string }): Promise<Paginated<OrderListRow>> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const qb = this.dataSource.getRepository(Order).createQueryBuilder('o')
      .leftJoin(Customer, 'c', 'c.id = o.customer_id')
      .addSelect(['c.name', 'c.code']);
    if (query.status) qb.andWhere('o.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('o.customer_id = :customerId', { customerId: query.customerId });
    const term = query.search?.trim();
    if (term) {
      qb.andWhere(
        '(o.code ILIKE :like OR o.id::text ILIKE :like OR c.name ILIKE :like OR c.code ILIKE :like)',
        { like: `%${escapeLike(term)}%` },
      );
    }
    qb.orderBy('o.created_at', 'DESC').addOrderBy('o.id', 'DESC').offset((page - 1) * pageSize).limit(pageSize); // one customer per order, so plain LIMIT is safe
    const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
    const byId = new Map(raw.map((r: Record<string, string | null>) => [r.o_id, r]));
    const items = entities.map((o) => {
      const r = byId.get(o.id);
      return Object.assign(o, { customerName: r?.c_name ?? null, customerCode: r?.c_code ?? null });
    });
    return { items, total, page, pageSize };
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
