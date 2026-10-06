import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** ERP calls that reached josh directly (erp.fallback.received). Turned into ledger moves in stage 3 (stock). */
@Entity('josh_erp_fallback_calls')
export class JoshErpFallbackCall {
  @PrimaryColumn({ name: 'josh_outbox_id', type: 'bigint' }) joshOutboxId: string;
  @Column({ type: 'varchar', length: 10 }) method: string;
  @Column({ type: 'varchar', length: 200 }) path: string;
  @Column({ type: 'jsonb', nullable: true }) body: unknown;
  @Column({ name: 'received_at', type: 'timestamptz' }) receivedAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
