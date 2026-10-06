import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Commerce's copy of josh customers (spec 2026-10-06 §2.2): marketing-safe columns only, fed by
 * customer.snapshot. deleted_at = PDPA delete: data wiped, row kept so an older snapshot can't revive it.
 */
@Entity('josh_customers')
export class JoshCustomerCopy {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ type: 'jsonb', default: {} }) data: Record<string, unknown>;
  @Column({ name: 'source_version', type: 'bigint', default: 0 }) sourceVersion: string;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
