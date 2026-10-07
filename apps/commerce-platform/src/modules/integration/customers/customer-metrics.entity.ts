import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Per-customer order metrics, computed by commerce from josh_orders (stage 2a); pushed to josh's customer_metrics. */
@Entity('customer_metrics')
export class CustomerMetrics {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'lifetime_order_count', type: 'int', default: 0 }) lifetimeOrderCount: number;
  @Column({ name: 'lifetime_spend', type: 'numeric', precision: 14, scale: 2, default: 0 }) lifetimeSpend: string;
  @Column({ name: 'avg_order_value', type: 'numeric', precision: 14, scale: 2, default: 0 }) avgOrderValue: string;
  @Column({ name: 'first_order_at', type: 'timestamptz', nullable: true }) firstOrderAt: Date | null;
  @Column({ name: 'last_order_at', type: 'timestamptz', nullable: true }) lastOrderAt: Date | null;
  @Column({ name: 'order_count_90d', type: 'int', default: 0 }) orderCount90d: number;
  @Column({ name: 'spend_90d', type: 'numeric', precision: 14, scale: 2, default: 0 }) spend90d: string;
  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' }) computedAt: Date;
}
