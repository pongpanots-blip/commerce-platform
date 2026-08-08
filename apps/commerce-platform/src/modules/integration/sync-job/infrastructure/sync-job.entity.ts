import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type SyncOperation = 'customers' | 'products' | 'inventory' | 'prices';
export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** A tracked run of an adapter sync operation for one integration. */
@Entity('sync_jobs')
@Index(['integrationId', 'status'])
export class SyncJob extends BaseEntity {
  @Column({ type: 'uuid', name: 'integration_id' })
  integrationId: string;

  @Column({ type: 'varchar', length: 16 })
  operation: SyncOperation;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: SyncJobStatus;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
