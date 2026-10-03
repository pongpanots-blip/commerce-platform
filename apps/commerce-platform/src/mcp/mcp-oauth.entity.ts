import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** An AI client (Claude, ChatGPT, …) that registered itself via OAuth dynamic client registration. */
@Entity('mcp_oauth_clients')
export class McpOAuthClient {
  @PrimaryColumn({ name: 'client_id', type: 'varchar', length: 64 }) clientId: string;
  /** Full RFC 7591 client record as the MCP SDK expects it back (incl. client_secret, compared by the SDK). */
  @Column({ type: 'jsonb' }) info: OAuthClientInformationFull;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

export type McpGrantKind = 'request' | 'code' | 'access' | 'refresh' | 'confirm';

/**
 * Every short-lived OAuth artefact, keyed by sha256 of its secret value — the
 * plaintext (request id, code, tokens) is only ever handed to the client.
 * request = pending login page · code = authorization code · access / refresh = tokens ·
 * confirm = one-time code that turns a write tool's preview into the real change.
 */
@Entity('mcp_oauth_grants')
@Index('ix_mcp_oauth_grants_expires', ['expiresAt'])
export class McpOAuthGrant {
  @PrimaryColumn({ name: 'id_hash', type: 'varchar', length: 64 }) idHash: string;
  @Column({ type: 'varchar', length: 12 }) kind: McpGrantKind;
  @Column({ name: 'client_id', type: 'varchar', length: 64 }) clientId: string;
  @Column({ name: 'staff_user_id', type: 'uuid', nullable: true }) staffUserId: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) scopes: string[];
  /** request/code: { codeChallenge, redirectUri, state?, resource?, scopes? } · confirm: { tool, argsHash } */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) data: Record<string, string | undefined>;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  /** Set once a request/code/refresh token is consumed (single use) or a token is revoked. */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true }) usedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
