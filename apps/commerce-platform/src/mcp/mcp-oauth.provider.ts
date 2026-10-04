import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

/** read = look up + summarize. write = the few change tools, only when the staff member ticks it at sign-in. */
export const MCP_SCOPE = 'commerce.read';
export const MCP_WRITE_SCOPE = 'commerce.write';
export const MCP_SCOPES = [MCP_SCOPE, MCP_WRITE_SCOPE];
const TTL = { request: 10 * 60, code: 5 * 60, access: 60 * 60, refresh: 30 * 24 * 60 * 60, confirm: 10 * 60 } satisfies Record<McpGrantKind, number>;

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
    if (params.scopes?.some((s) => !MCP_SCOPES.includes(s))) throw new InvalidScopeError(`available scopes: ${MCP_SCOPES.join(' ')}`);
    // Park the request server-side: the login form only carries an opaque id, so its fields can't be tampered with.
    // No scope requested = the client takes what it is given (read, plus write if the staff member allows it).
    const requested = params.scopes?.length ? params.scopes : MCP_SCOPES;
    const requestId = await this.issue('request', client.client_id, {
      data: { codeChallenge: params.codeChallenge, redirectUri: params.redirectUri, state: params.state, resource: params.resource?.href, scopes: requested.join(' ') },
    });
    res.status(200).type('html').send(loginPage({ requestId, clientName: client.client_name ?? client.client_id, canWrite: requested.includes(MCP_WRITE_SCOPE) }));
  }

  /**
   * POST of the login page. Returns where to send the browser: the client's redirect_uri with a
   * code, or null + an error to re-render the page.
   */
  async completeLogin(requestId: string, email: string, password: string, allowWrite = false): Promise<{ redirect: string } | { error: string; clientName: string; canWrite: boolean }> {
    const request = await this.live(requestId, 'request');
    if (!request) return { error: 'คำขอเชื่อมต่อหมดอายุ กรุณากดเชื่อมต่อจากแอป AI ใหม่', clientName: '', canWrite: false };
    const client = await this.clients.findOneBy({ clientId: request.clientId });
    const clientName = client?.info.client_name ?? request.clientId;
    const canWrite = (request.data.scopes ?? '').split(' ').includes(MCP_WRITE_SCOPE);
    let user: User;
    try { user = await this.auth.verifyCredentials(email, password); } catch { return { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', clientName, canWrite }; }
    const staff = await this.staff(user.id);
    if (!staff) return { error: 'บัญชีนี้ไม่ใช่ staff ของ commerce จึงเชื่อมต่อ AI ไม่ได้', clientName, canWrite };
    if (!(await this.consume(request))) return { error: 'คำขอนี้ถูกใช้ไปแล้ว กรุณากดเชื่อมต่อจากแอป AI ใหม่', clientName, canWrite };
    const scopes = allowWrite && canWrite ? MCP_SCOPES : [MCP_SCOPE];
    const code = await this.issue('code', request.clientId, { staffUserId: staff.userId, data: request.data, scopes });
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

  private async tokens(clientId: string, staffUserId: string, scopes: string[]): Promise<OAuthTokens> {
    return {
      access_token: await this.issue('access', clientId, { staffUserId, scopes }),
      refresh_token: await this.issue('refresh', clientId, { staffUserId, scopes }),
      token_type: 'bearer', expires_in: TTL.access, scope: scopes.join(' '),
    };
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const grant = await this.live(code, 'code', client.client_id); // PKCE itself is checked by the SDK before this
    if (!grant || (redirectUri && redirectUri !== grant.data.redirectUri)) throw new InvalidGrantError('invalid authorization code');
    if (!(await this.consume(grant))) throw new InvalidGrantError('authorization code already used');
    return this.tokens(client.client_id, grant.staffUserId!, grant.scopes);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[]): Promise<OAuthTokens> {
    const grant = await this.live(refreshToken, 'refresh', client.client_id);
    if (!grant || !(await this.staff(grant.staffUserId))) throw new InvalidGrantError('invalid refresh token');
    // A refresh can narrow the scopes, never widen them.
    if (scopes?.some((s) => !grant.scopes.includes(s))) throw new InvalidScopeError('cannot add scopes on refresh');
    if (!(await this.consume(grant))) throw new InvalidGrantError('refresh token already used'); // rotation
    return this.tokens(client.client_id, grant.staffUserId!, scopes?.length ? scopes : grant.scopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = await this.live(token, 'access');
    const staff = grant && (await this.staff(grant.staffUserId));
    if (!grant || !staff) throw new InvalidTokenError('invalid or expired token');
    return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(grant.expiresAt.getTime() / 1000), extra: { staff } };
  }

  /** Step 1 of a write tool: a one-time code bound to this staff member, AI client, tool and exact arguments. */
  issueConfirm(staffUserId: string, clientId: string, tool: string, argsHash: string) {
    return this.issue('confirm', clientId, { staffUserId, data: { tool, argsHash } });
  }

  /** Step 2: true only once, and only for the same staff, client, tool and arguments the preview was for. */
  async consumeConfirm(code: string, staffUserId: string, clientId: string, tool: string, argsHash: string) {
    const grant = await this.live(code, 'confirm', clientId);
    if (!grant || grant.staffUserId !== staffUserId || grant.data.tool !== tool || grant.data.argsHash !== argsHash) return false;
    return this.consume(grant);
  }

  /**
   * Daily housekeeping. Minute-lived rows (sign-in requests, codes, confirm codes) go a day after
   * expiry; tokens stay 30 days past expiry so the AI connectors page still shows recent connections.
   * Plain idempotent DELETE, safe if several instances run it.
   */
  @Cron('0 4 * * *', { timeZone: 'Asia/Bangkok' })
  async purgeExpired() {
    const result = await this.grants.query(
      `DELETE FROM mcp_oauth_grants
       WHERE (kind IN ('request', 'code', 'confirm') AND expires_at < now() - interval '1 day')
          OR expires_at < now() - interval '30 days'`);
    const removed = Array.isArray(result) ? Number(result[1] ?? 0) : 0;
    if (removed) Logger.log(`MCP OAuth housekeeping removed ${removed} expired rows`, 'Mcp');
    return removed;
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.grants.update({ idHash: hashOf(request.token), clientId: client.client_id, usedAt: IsNull() }, { usedAt: new Date() });
  }
}
