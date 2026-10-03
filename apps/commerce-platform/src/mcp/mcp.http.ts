import { INestApplication, Logger } from '@nestjs/common';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_SCOPE, MCP_SCOPES, McpOAuthProvider, McpStaff } from './mcp-oauth.provider';
import { McpTools } from './mcp.tools';
import { loginPage } from './mcp-login.page';

/**
 * Mounts the MCP endpoint and its OAuth server on the root of the HTTP server
 * (AI clients discover /.well-known/* at the origin, so this sits outside /api):
 *
 *   /.well-known/oauth-authorization-server · /.well-known/oauth-protected-resource/mcp
 *   /register · /authorize · /token · /revoke   (MCP SDK; PKCE + dynamic client registration)
 *   /mcp/oauth/login                             (our staff sign-in page posts here)
 *   /mcp                                         (Streamable HTTP, stateless, bearer token)
 *
 * Off unless MCP_PUBLIC_URL is set — the public https origin AI clients reach us on.
 */
export function mountMcp(app: INestApplication) {
  const base = process.env.MCP_PUBLIC_URL?.trim().replace(/\/$/, '');
  if (!base) {
    Logger.log('MCP server off (set MCP_PUBLIC_URL to enable)', 'Mcp');
    return;
  }
  const provider = app.get(McpOAuthProvider);
  const tools = app.get(McpTools);
  const http = app.getHttpAdapter().getInstance() as express.Express;
  const resourceUrl = new URL(`${base}/mcp`);
  // Behind nginx: count hops so rate limits key on the real client IP, not the proxy.
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (hops > 0) http.set('trust proxy', hops);

  http.use(mcpAuthRouter({
    provider, issuerUrl: new URL(base), resourceServerUrl: resourceUrl,
    scopesSupported: MCP_SCOPES, resourceName: 'Commerce Platform',
  }));

  // Password guessing protection for the staff sign-in page.
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
  http.post('/mcp/oauth/login', loginLimit, express.urlencoded({ extended: false, limit: '8kb' }), async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const field = (key: string) => (typeof body?.[key] === 'string' ? (body[key] as string) : '');
    const requestId = field('request_id');
    try {
      const result = await provider.completeLogin(requestId, field('email'), field('password'), field('allow_write') === '1');
      if ('redirect' in result) return res.redirect(302, result.redirect);
      res.status(400).type('html').send(loginPage({ requestId, clientName: result.clientName, error: result.error, canWrite: result.canWrite }));
    } catch (error) {
      Logger.error(`MCP login failed: ${error instanceof Error ? error.message : error}`, 'Mcp');
      res.status(500).type('html').send(loginPage({ requestId, clientName: '', error: 'ระบบขัดข้อง กรุณาลองใหม่' }));
    }
  });

  const bearer = requireBearerAuth({
    verifier: provider, requiredScopes: [MCP_SCOPE],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });
  http.post('/mcp', bearer, express.json({ limit: '1mb' }), async (req, res) => {
    const server = tools.server(req.auth!.extra!.staff as McpStaff, req.auth!.clientId, req.auth!.scopes);
    // Stateless: one server + transport per request, JSON responses (no SSE session to keep).
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      Logger.error(`MCP request failed: ${error instanceof Error ? error.message : error}`, 'Mcp');
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  // No server-initiated stream or session to delete in stateless mode.
  http.get('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').end(); });
  http.delete('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').end(); });

  Logger.log(`MCP server on ${resourceUrl.href}`, 'Mcp');
}
