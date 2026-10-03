import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MarketingResearchTopic } from './marketing-research-topic.entity';
import type {
  ResearchReport,
  ResearchRunStatus,
  ResearchScope,
  ResearchSource,
} from '../research.types';

@Entity('marketing_research_runs')
@Index('uq_research_run_key', ['topicId', 'requestKey'], { unique: true })
@Index('uq_research_active_run', ['topicId'], {
  unique: true,
  where: "\"status\" IN ('queued', 'running')",
})
@Index('ix_research_runs_history', ['topicId', 'createdAt'])
@Index('ix_research_runs_claim', ['status', 'leaseExpiresAt'])
export class MarketingResearchRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) topicId: string;
  @ManyToOne(() => MarketingResearchTopic, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'topicId' })
  topic: MarketingResearchTopic;
  @Column({ type: 'varchar', length: 100 }) requestKey: string;
  @Column({ type: 'uuid', nullable: true }) requestedBy: string | null;
  @Column({ type: 'int' }) topicVersion: number;
  @Column({ type: 'jsonb' }) scope: ResearchScope;
  @Column({ type: 'jsonb' }) availableSources: ResearchSource[];
  @Column({ type: 'varchar', length: 30 }) status: ResearchRunStatus;
  @Column({ type: 'text', default: '' }) message: string;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ type: 'uuid', nullable: true, select: false }) leaseToken:
    | string
    | null;
  @Column({ type: 'timestamptz', nullable: true }) leaseExpiresAt: Date | null;
  @Column({ type: 'jsonb', nullable: true }) report: ResearchReport | null;
  @Column({ type: 'int', default: 0 }) findingsCount: number;
  @Column({ type: 'uuid', nullable: true }) keptBy: string | null;
  @Column({ type: 'timestamptz', nullable: true }) keptAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) finishedAt: Date | null;
}
