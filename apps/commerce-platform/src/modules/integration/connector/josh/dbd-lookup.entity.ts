import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Last DBD answer per juristic register number (josh onboarding asks through commerce: DBD_VIA_COMMERCE). */
@Entity('dbd_lookups')
export class DbdLookup {
  @PrimaryColumn({ name: 'register_number', length: 13 }) registerNumber: string;
  /** DBD's HTTP status: 200 found / 404 no such company. Other answers are not kept. */
  @Column({ name: 'http_status', type: 'int' }) httpStatus: number;
  @Column({ type: 'jsonb', nullable: true }) body: unknown;
  @Column({ name: 'fetched_at', type: 'timestamptz' }) fetchedAt: Date;
}
