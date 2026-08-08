import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

/**
 * Routing decision + status timeline for ONE order line. The order's headline
 * status is derived from its fulfillments (multi-timeline stitched to one view).
 */
@Entity('order_fulfillments')
@Index(['orderId'])
export class OrderFulfillment extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @Column({ type: 'uuid', name: 'order_line_id', unique: true })
  orderLineId: string;

  /** Fulfillment source — only 'erp' this cycle (native/dropship later). */
  @Column({ type: 'varchar', length: 16, default: 'erp' })
  source: string;

  @Column({ type: 'varchar', length: 12 })
  mode: string; // 'on_hand' | 'to_order'

  /** pending → reserved → confirmed | failed | released | expired */
  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: string;

  @Column({ type: 'uuid', name: 'reservation_id', nullable: true })
  reservationId: string | null;
}
