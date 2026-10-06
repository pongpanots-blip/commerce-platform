import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { MarketAnalysisReport } from '@cp/growth';

@Entity('market_analysis_reports')
export class MarketAnalysis {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') createdBy!: string;
  @Column({ type: 'varchar', length: 64 }) requestHash!: string;
  @Column('jsonb') report!: MarketAnalysisReport;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
