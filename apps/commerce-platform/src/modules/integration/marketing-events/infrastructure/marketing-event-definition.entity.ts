import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { EventAttributeDef, EventEvidence } from '@cp/marketing-workflow';

/** The event catalog (spec §4, §14): ingest accepts only these names and declared attributes. */
@Entity('marketing_event_definitions')
export class MarketingEventDefinitionRow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) name: string;
  @Column({ type: 'varchar', length: 120 }) label: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) attributes: EventAttributeDef[];
  @Column({ type: 'varchar', length: 8, default: 'browser' }) evidence: EventEvidence;
  @Column({ type: 'varchar', length: 10, default: 'active' }) status: 'active' | 'archived';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
