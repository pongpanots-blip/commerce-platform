import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Shop live chat traffic commerce relayed between josh and CS-CRM (one row per call). */
@Entity('livechat_logs')
@Index('ix_livechat_logs_visitor', ['visitorId', 'createdAt'])
export class LivechatLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** to_cs_crm = customer → agents · to_shop = agent reply → customer */
  @Column({ length: 12 }) direction: 'to_cs_crm' | 'to_shop';
  @Column({ length: 120 }) route: string;
  @Column({ name: 'visitor_id', type: 'varchar', length: 100, nullable: true }) visitorId: string | null;
  @Column({ type: 'text', nullable: true }) text: string | null;
  @Column({ type: 'int' }) status: number;
  @Column({ type: 'jsonb', nullable: true }) payload: object | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
