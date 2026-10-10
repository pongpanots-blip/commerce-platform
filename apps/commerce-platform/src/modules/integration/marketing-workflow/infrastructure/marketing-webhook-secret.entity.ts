import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** A webhook header value kept out of the workflow JSON (spec §4.6); the plain value is never returned by any API. */
@Entity('marketing_webhook_secrets')
export class MarketingWebhookSecret {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 128 }) name: string;
  @Column({ name: 'value_encrypted', type: 'text' }) valueEncrypted: string;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
