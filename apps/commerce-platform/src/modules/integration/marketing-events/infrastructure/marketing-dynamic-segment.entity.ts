import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { EventRule } from '@cp/marketing-workflow';

/** A named event rule, evaluated live in commerce only — never frozen, never sent to josh (spec §11). */
@Entity('marketing_dynamic_segments')
export class MarketingDynamicSegmentRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 155 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'jsonb' }) rule: EventRule;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
