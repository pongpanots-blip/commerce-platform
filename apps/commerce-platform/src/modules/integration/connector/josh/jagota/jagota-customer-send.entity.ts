import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One customer registration (josh `POST /customers/create-customer`) commerce sent to Jagota on
 * josh's behalf, keyed by the contact email — ERP's own identity for a registration. A `sent` one
 * is never sent again; its stored answer is replayed (same rule as jagota_order_sends).
 */
@Entity('jagota_customer_sends')
@Index('ix_jagota_customer_sends_updated', ['updatedAt'])
export class JagotaCustomerSend {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** customerContact[0].Email, lower-cased. */
  @Column({ length: 254, unique: true }) email: string;
  @Column({ length: 12 }) status: 'sending' | 'sent' | 'failed';
  @Column({ type: 'jsonb' }) request: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) response: Record<string, unknown> | null;
  /** The CUST_CODE ERP answered (INA… for a converted household, else the prospect code). */
  @Column({ name: 'cust_code', type: 'varchar', length: 40, nullable: true }) custCode: string | null;
  @Column({ type: 'int', default: 1 }) attempts: number;
  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true }) lastError: string | null;
  @Column({ name: 'duration_ms', type: 'int', nullable: true }) durationMs: number | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}
