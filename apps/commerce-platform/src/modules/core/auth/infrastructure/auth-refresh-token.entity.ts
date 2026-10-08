import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RefreshAudience = 'staff' | 'portal';

/**
 * One opaque refresh token for a commerce-admin (staff) or developer-portal sign-in. Only the sha256 of the
 * token is stored (same idea as mcp_oauth_grants). Every refresh uses the token up and issues the next one in
 * the same family; a used token shown again means it leaked, so the whole family is revoked.
 */
@Entity('auth_refresh_token')
@Index('uq_auth_refresh_token_hash', ['tokenHash'], { unique: true })
@Index('ix_auth_refresh_token_user', ['userId'])
@Index('ix_auth_refresh_token_family', ['familyId'])
export class AuthRefreshToken {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  /** Every token rotated from one sign-in shares the family; revoking it ends that sign-in everywhere. */
  @Column({ name: 'family_id', type: 'uuid' }) familyId: string;
  /** When the family's sign-in happened; no token of the family lives past it + AUTH_REFRESH_TOKEN_FAMILY_MAX_DAYS. */
  @Column({ name: 'family_created_at', type: 'timestamptz' }) familyCreatedAt: Date;
  @Column({ name: 'token_hash', type: 'varchar', length: 64 }) tokenHash: string;
  @Column({ type: 'varchar', length: 12 }) audience: RefreshAudience;
  /** The account's role when the family was signed in; a different role at refresh ends the family. */
  @Column({ name: 'role_at_issue', type: 'varchar', length: 24 }) roleAtIssue: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  /** Set once, when the token is exchanged for the next one. */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true }) usedAt: Date | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  /** logout · reuse · family_expired · disabled · role_changed · password_reset · password_changed · account_changed · cli */
  @Column({ name: 'revoked_reason', type: 'varchar', length: 32, nullable: true }) revokedReason: string | null;
  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true }) replacedById: string | null;
  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true }) userAgent: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) ip: string | null;
}
