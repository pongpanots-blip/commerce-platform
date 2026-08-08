import { Column } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

/**
 * Shared columns for every external-ID mapping table. Concrete tables add an
 * `@Entity` decorator and unique constraints. This is the ONLY place external
 * (ERP) IDs are stored — never as a primary key on a canonical entity.
 */
export abstract class ExternalMappingBase extends BaseEntity {
  @Column({ type: 'uuid', name: 'integration_id' })
  integrationId: string;

  @Column({ type: 'uuid', name: 'platform_id' })
  platformId: string;

  @Column({ type: 'varchar', length: 191, name: 'external_id' })
  externalId: string;

  @Column({ type: 'jsonb', name: 'external_ref', nullable: true })
  externalRef: Record<string, unknown> | null;
}
