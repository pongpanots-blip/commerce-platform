import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { WorkflowInput } from '../domain/workflow.types';

@Entity('marketing_workflow_revisions')
export class MarketingWorkflowRevisionRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'workflow_id', type: 'uuid' }) workflowId: string;
  @Column({ type: 'jsonb' }) snapshot: WorkflowInput;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
