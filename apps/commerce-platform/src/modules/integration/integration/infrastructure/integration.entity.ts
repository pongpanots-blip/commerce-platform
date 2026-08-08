import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type IntegrationStatus = 'active' | 'disabled';

/**
 * A configured external system (an ERP, POS, marketplace, ...). Referenced by
 * webhooks, mappings, and sync jobs. `type` selects the connector; `config`
 * holds connector-specific settings; `signingSecret` verifies inbound webhooks.
 */
@Entity('integrations')
@Index(['type'])
export class Integration extends BaseEntity {
  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  /**
   * Human-readable, unique URL segment for this integration's webhook endpoint:
   * `POST /webhooks/<slug>` (e.g. "shopify"). Defaults to the connector type.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  slug: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: IntegrationStatus;

  @Column({ type: 'jsonb', default: {} })
  config: Record<string, unknown>;

  @Column({ type: 'varchar', length: 255, name: 'signing_secret', nullable: true })
  signingSecret: string | null;
}
