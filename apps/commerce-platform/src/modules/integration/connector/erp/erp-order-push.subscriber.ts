import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource, In } from 'typeorm';
import { Order } from '../../../commerce/order/infrastructure/order.entity';
import { OrderLine } from '../../../commerce/order/infrastructure/order-line.entity';
import { Product } from '../../../commerce/product/infrastructure/product.entity';
import { Customer } from '../../../commerce/customer/infrastructure/customer.entity';
import { Integration } from '../../integration/infrastructure/integration.entity';
import { MappingService } from '../../mapping/application/mapping.service';
import { ErpClientConfig, ErpHttpClient } from './erp-http.client';

/**
 * Outbound order push (spec §1): confirmed platform orders flow to the ERP
 * through the mock-gated client. Push is a SIDE EFFECT — any failure here is
 * logged and swallowed; the order itself is already confirmed and must never
 * be blocked or rolled back by ERP availability. (Retry queue = 3b backlog.)
 */
@Injectable()
export class ErpOrderPushSubscriber {
  private readonly logger = new Logger(ErpOrderPushSubscriber.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly client: ErpHttpClient,
    private readonly mapping: MappingService,
  ) {}

  @OnEvent('order.confirmed')
  async onOrderConfirmed(event: { aggregateId: string }): Promise<void> {
    try {
      await this.push(event.aggregateId);
    } catch (error) {
      this.logger.warn(`ERP order push failed for ${event.aggregateId}: ${error}`);
    }
  }

  private async push(orderId: string): Promise<void> {
    const erp = await this.dataSource.getRepository(Integration)
      .findOne({ where: { type: 'erp', status: 'active' } });
    if (!erp) {
      this.logger.debug(`no active erp integration — skipping order push for ${orderId}`);
      return;
    }

    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    if (!order || order.status !== 'confirmed') return;

    const lines = await this.dataSource.getRepository(OrderLine).find({ where: { orderId } });
    const products = await this.dataSource.getRepository(Product)
      .find({ where: { id: In(lines.map((l) => l.productId)) } });
    const skuById = new Map(products.map((p) => [p.id, p.sku]));
    const customer = await this.dataSource.getRepository(Customer)
      .findOne({ where: { id: order.customerId } });

    const res = await this.client.createOrder({
      platformOrderId: order.id,
      customerCode: customer?.code ?? null,
      lines: lines.map((l) => ({
        sku: skuById.get(l.productId) ?? 'UNKNOWN',
        qty: Number(l.qty),
        unitPrice: l.unitPrice,
      })),
      total: order.total,
      currency: order.currency,
    }, (erp.config ?? {}) as ErpClientConfig);

    if (!res.ok || !res.erpOrderRef) {
      this.logger.warn(`ERP createOrder failed for ${orderId}: ${res.error}`);
      return;
    }
    await this.mapping.link(erp.id, 'order', orderId, res.erpOrderRef);
    this.logger.log(`order ${orderId} pushed to ERP as ${res.erpOrderRef}`);
  }
}
