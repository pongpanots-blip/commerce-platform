import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { GrowthEvidence, GrowthHistory, GrowthPlanInput, GrowthStatus, GrowthTask } from '@cp/growth';

@Entity('growth_plans')
@Index('ix_growth_plans_updated', ['updatedAt'])
export class GrowthCampaignPlan {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') createdBy: string;
  @Column({ type: 'varchar', length: 64 }) requestHash: string;
  @Column({ type: 'jsonb' }) plan: GrowthPlanInput;
  @Column({ type: 'jsonb', default: [] }) evidence: GrowthEvidence[];
  @Column({ type: 'jsonb', default: [] }) tasks: GrowthTask[];
  @Column({ type: 'jsonb', default: [] }) history: (GrowthHistory & { snapshot?: GrowthPlanInput; evidence?: GrowthEvidence[] })[];
  @Column({ type: 'int', default: 1 }) version: number;
  @Column({ type: 'varchar', length: 24, default: 'draft' }) status: GrowthStatus;
  @Column({ type: 'uuid', nullable: true }) approvedBy: string | null;
  @Column({ type: 'int', nullable: true }) approvedVersion: number | null;
  @Index('uq_growth_workflow', { unique: true })
  @Column({ type: 'uuid', nullable: true }) workflowId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
