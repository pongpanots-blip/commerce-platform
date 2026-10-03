import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidScopeError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { PortalAuthService } from '../modules/core/auth/application/portal-auth.service';
import { User } from '../modules/core/user/infrastructure/user.entity';
import { STAFF_ROLES, StaffRole } from '../shared-kernel/presentation/auth.decorators';
import { McpGrantKind, McpOAuthClient, McpOAuthGrant } from './mcp-oauth.entity';
import { loginPage } from './mcp-login.page';

/** Only scope for now: read + summarize. Writes would get their own scope. */
export const MCP_SCOPE = 'commerce.read';
const TTL = { request: 10 * 60, code: 5 * 60, access: 60 * 60, refresh: 30 * 24 * 60 * 60 } satisfies Record<McpGrantKind, number>;

const secret = () => randomBytes(32).toString('base64url');
export const hashOf = (value: string) => createHash('sha256').update(value).digest('hex');

export type McpStaff = { userId: string; email: string; role: StaffRole };

/**
 * OAuth 2.1 authorization server for AI connectors (Claude, ChatGPT …), plugged
 * into the MCP SDK's router (PKCE + dynamic client registration are done by the
 * SDK). Who: commerce staff sign in on our own login page; the token carries
 * their user id and is re-checked against `users` on every MCP call, so
 * disabling a staff account cuts its AI access at once.
 */
@Injectable()
export class McpOAuthProvider implements OAuthServerProvider {
  constructor(
    @InjectRepository(McpOAuthClient) private readonly clients: Repository<McpOAuthClient>,
    @InjectRepository(McpOAuthGrant) private readonly grants: Repository<McpOAuthGrant>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: PortalAuthService,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId) => (await this.clients.findOneBy({ clientId }))?.info,
      registerClient: async (client) => {
        const info = client as OAuthClientInformationFull; // the SDK router assigns client_id (clientIdGeneration)
        await this.clients.save(this.clients.create({ clientId: info.client_id, info }));
        return info;
      },
    };
  }

  private async issue(kind: McpGrantKind, clientId: string, fields: Partial<McpOAuthGrant> = {}) {
    const value = secret();
    await this.grants.save(this.grants.create({
      idHash: hashOf(value), kind, clientId, scopes: [MCP_SCOPE], data: {}, staffUserId: null,
      ...fields, expiresAt: new Date(Date.now() + TTL[kind] * 1000),
    }));
    return value;
  }

  /** A live, unused grant of this kind (and client, when given). */
  private live(value: string, kind: McpGrantKind, clientId?: string) {
    return this.grants.findOneBy({ idHash: hashOf(value), kind, usedAt: IsNull(), expiresAt: MoreThan(new Date()), ...(clientId ? { clientId } : {}) });
  }

  /** Single use: only the caller that flips used_at wins (codes and refresh tokens). */
  private async consume(grant: McpOAuthGrant) {
    const result = await this.grants.update({ idHash: grant.idHash, usedAt: IsNull() }, { usedAt: new Date() });
    return result.affected === 1;
  }

  private async staff(userId: string | null): Promise<McpStaff | null> {
    const user = userId ? await this.users.findOneBy({ id: userId }) : null;
    return user && user.status === 'active' && STAFF_ROLES.includes(user.role as StaffRole)
      ? { userId: user.id, email: user.email, role: user.role as StaffRole } : null;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.scopes?.some((s) => s !== MCP_SCOPE)) throw new InvalidScopeError(`only "${MCP_SCOPE}" is available`);
    // Park the request server-side: the login form only carries an opaque id, so its fields can't be tampered with.
    const requestId = await this.issue('request', client.client_id, {
      data: { codeChallenge: params.codeChallenge, redirectUri: params.redirectUri, state: params.state, resource: params.resource?.href },
    });
    res.status(200).type('html').send(loginPage({ requestId, clientName: client.client_name ?? client.client_id }));
  }

  /**
   * POST of the login page. Returns where to send the browser: the client's redirect_uri with a
   * code, or null + an error to re-render the page.
   */
  async completeLogin(requestId: string, email: string, password: string): Promise<{ redirect: string } | { error: string; clientName: string }> {
    const request = await this.live(requestId, 'request');
    if (!request) return { error: 'คำขอเชื่อมต่อหมดอายุ กรุณากดเชื่อมต่อจากแอป AI ใหม่', clientName: '' };
    const client = await this.clients.findOneBy({ clientId: request.clientId });
    const clientName = client?.info.client_name ?? request.clientId;
    let user: User;
    try { user = await this.auth.verifyCredentials(email, password); } catch { return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', clientName }; }
    const staff = await this.staff(user.id);
    if (!staff) return { error: 'บัญชีนี้ไม่ใช่ staff ของ commerce จึงเชื่อมต่อ AI ไม่ได้', clientName };
    if (!(await this.consume(request))) return { error: 'คำขอนี้ถูกใช้ไปแล้ว กรุณากดเชื่อมต่อจากแอป AI ใหม่', clientName };
    const code = await this.issue('code', request.clientId, { staffUserId: staff.userId, data: request.data });
    const target = new URL(request.data.redirectUri!);
    target.searchParams.set('code', code);
    if (request.data.state) target.searchParams.set('state', request.data.state);
    return { redirect: target.href };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const grant = await this.live(code, 'code', client.client_id);
    if (!grant) throw new InvalidGrantError('invalid authorization code');
    return grant.data.codeChallenge!;
  }

  private async tokens(clientId: string, staffUserId: string): Promise<OAuthTokens> {
    return {
      access_token: await this.issue('access', clientId, { staffUserId }),
      refresh_token: await this.issue('refresh', clientId, { staffUserId }),
      token_type: 'bearer', expires_in: TTL.access, scope: MCP_SCOPE,
    };
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const grant = await this.live(code, 'code', client.client_id); // PKCE itself is checked by the SDK before this
    if (!grant || (redirectUri && redirectUri !== grant.data.redirectUri)) throw new InvalidGrantError('invalid authorization code');
    if (!(await this.consume(grant))) throw new InvalidGrantError('authorization code already used');
    return this.tokens(client.client_id, grant.staffUserId!);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
    if (scopes?.some((s) => s !== MCP_SCOPE)) throw new InvalidScopeError(`only "${MCP_SCOPE}" is available`);
    const grant = await this.live(refreshToken, 'refresh', client.client_id);
    if (!grant || !(await this.staff(grant.staffUserId))) throw new InvalidGrantError('invalid refresh token');
    if (!(await this.consume(grant))) throw new InvalidGrantError('refresh token already used'); // rotation
    return this.tokens(client.client_id, grant.staffUserId!);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = await this.live(token, 'access');
    const staff = grant && (await this.staff(grant.staffUserId));
    if (!grant || !staff) throw new InvalidTokenError('invalid or expired token');
    return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(grant.expiresAt.getTime() / 1000), extra: { staff } };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.grants.update({ idHash: hashOf(request.token), clientId: client.client_id, usedAt: IsNull() }, { usedAt: new Date() });
  }
}
