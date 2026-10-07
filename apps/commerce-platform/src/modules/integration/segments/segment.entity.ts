import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A customer segment, owned by commerce (stage 2a). Same columns and ids as josh's user_segments, which receives
 * every change as segment.* events — coupons, banners and workflows in josh keep referencing these ids.
 */
@Entity('segments')
export class Segment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80, unique: true }) slug: string;
  @Column({ type: 'varchar', length: 155 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'rule_type', type: 'varchar', length: 40 }) rule_type: string;
  @Column({ name: 'rule_config', type: 'jsonb', default: () => "'{}'" }) rule_config: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) definition: Record<string, unknown> | null;
  @Column({ type: 'int', default: 0 }) priority: number;
  @Column({ name: 'is_active', type: 'boolean', default: true }) is_active: boolean;
  @Column({ name: 'frozen_at', type: 'timestamptz', nullable: true }) frozen_at: Date | null;
  @Column({ name: 'member_count', type: 'int', nullable: true }) member_count: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updated_at: Date;
}

/** A frozen segment's member (josh: segment_membership_snapshots). */
@Entity('segment_members')
export class SegmentMember {
  @PrimaryColumn({ name: 'segment_id', type: 'uuid' }) segment_id: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) user_id: string;
  @Column({ name: 'matched_at', type: 'timestamptz', default: () => 'now()' }) matched_at: Date;
}
