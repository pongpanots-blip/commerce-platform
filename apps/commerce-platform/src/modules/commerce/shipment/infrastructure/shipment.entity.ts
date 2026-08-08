import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('shipments')
@Index(['orderId'])
export class Shipment extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  carrier: string | null;

  @Column({ type: 'varchar', length: 128, name: 'tracking_no', nullable: true })
  trackingNo: string | null;

  @Column({ type: 'timestamp with time zone', name: 'shipped_at', nullable: true })
  shippedAt: Date | null;
}
