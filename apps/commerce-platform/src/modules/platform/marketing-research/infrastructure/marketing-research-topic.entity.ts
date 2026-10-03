import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ResearchKind,
  ResearchSource,
} from '../research.types';

@Entity('marketing_research_topics')
@Index('ix_research_topics_due', ['nextRunAt'], {
  where: '"archivedAt" IS NULL AND "followHourly" = true',
})
export class MarketingResearchTopic {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 400 }) title: string;
  @Column({ type: 'varchar', length: 20 }) kind: ResearchKind;
  @Column({ type: 'varchar', length: 100 }) area: string;
  @Column({ type: 'int', default: 30 }) days: number;
  @Column({ type: 'varchar', length: 100 }) sector: string;
  @Column({ type: 'jsonb' }) sources: ResearchSource[];
  @Column({ type: 'boolean', default: false }) followHourly: boolean;
  @Column({ type: 'uuid' }) createdBy: string;
  @Column({ type: 'int', default: 1 }) version: number;
  @Column({ type: 'timestamptz', nullable: true }) nextRunAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) archivedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
