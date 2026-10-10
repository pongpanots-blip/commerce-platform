import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { CanvasPosition, ExitGoal, TriggerConfig, TriggerType, WorkflowSchedule, WorkflowStatus, WorkflowStep } from '../domain/workflow.types';

/** A commerce-run marketing workflow (spec 2026-10-10 §3). Field names follow josh's marketing_workflows for the phase-3 move. */
@Entity('marketing_workflows')
export class MarketingWorkflowRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'varchar', length: 16, default: 'draft' }) status: WorkflowStatus;
  @Column({ name: 'trigger_type', type: 'varchar', length: 32 }) triggerType: TriggerType;
  @Column({ name: 'trigger_config', type: 'jsonb', default: () => "'{}'" }) triggerConfig: TriggerConfig;
  @Column({ name: 'entry_step_id', type: 'varchar', length: 64, nullable: true }) entryStepId: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) steps: WorkflowStep[];
  @Column({ name: 'graph_ui', type: 'jsonb', nullable: true }) graphUi: Record<string, CanvasPosition> | null;
  @Column({ name: 'cooldown_days', type: 'int', default: 0 }) cooldownDays: number;
  @Column({ name: 'holdout_percent', type: 'int', default: 0 }) holdoutPercent: number;
  @Column({ name: 'conversion_window_days', type: 'int', default: 7 }) conversionWindowDays: number;
  @Column({ name: 'exit_on_goal', type: 'jsonb', nullable: true }) exitOnGoal: ExitGoal;
  @Column({ type: 'jsonb', nullable: true }) schedule: WorkflowSchedule;
  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true }) activatedAt: Date | null;
  /** Local date of the last scheduled run that enrolled its whole audience. */
  @Column({ name: 'last_scheduled_key', type: 'varchar', length: 16, nullable: true }) lastScheduledKey: string | null;
  @Column({ name: 'created_by', type: 'varchar', length: 128, nullable: true }) createdBy: string | null;
  @Column({ name: 'updated_by', type: 'varchar', length: 128, nullable: true }) updatedBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
