import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type ApiKeyScope = 'storefront';

/**
 * A hashed API key owned by a portal account. The full key (ck_live_...) is
 * shown exactly once at creation; only hash + display prefix are stored.
 */
@Entity('api_keys')
@Index(['accountId'])
@Index(['keyHash'], { unique: true })
export class ApiKey extends BaseEntity {
  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 16, name: 'key_prefix' })
  keyPrefix: string;

  @Column({ type: 'varchar', length: 64, name: 'key_hash' })
  keyHash: string;

  @Column({ type: 'varchar', length: 24, default: 'storefront' })
  scope: ApiKeyScope;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'timestamp with time zone', name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamp with time zone', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;
}
