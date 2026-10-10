import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { StaffRoles } from '../shared-kernel/presentation/auth.decorators';
import type { StaffRequest } from '../shared-kernel/presentation/auth.decorators';

class RevokeConnectionDto {
  /** admin only: whose connection to cut. Marketing always revokes their own. */
  @IsOptional() @IsUUID() staffUserId?: string;
}

/**
 * Admin page for AI connectors: how to connect, who is connected, what the AI read.
 * Marketing sees and revokes only their own connections; admin sees everyone's.
 */
@Controller('mcp-connections')
@StaffRoles('marketing')
export class McpConnectionsController {
  constructor(private readonly db: DataSource) {}

  /** Restrict to the caller unless admin. Returns [sql, params] fragments. */
  private scope(req: StaffRequest, column: string, params: unknown[]) {
    if (req.staff.role === 'admin') return '';
    params.push(req.staff.userId);
    return ` AND ${column} = $${params.length}`;
  }

  @Get()
  async list(@Req() req: StaffRequest) {
    const base = process.env.MCP_PUBLIC_URL?.trim().replace(/\/$/, '') || null;
    const params: unknown[] = [];
    const where = this.scope(req, 'g.staff_user_id', params);
    const connections = await this.db.query(
      `SELECT * FROM (SELECT g.client_id AS "clientId", coalesce(c.info->>'client_name', g.client_id) AS "clientName",
              g.staff_user_id AS "staffUserId", u.email AS "staffEmail", min(g.created_at) AS "firstSeenAt",
              count(*) FILTER (WHERE g.kind = 'refresh' AND g.used_at IS NULL AND g.expires_at > now())::int AS "liveSessions",
              coalesce(bool_or(g.scopes ? 'commerce.write') FILTER (WHERE g.kind = 'refresh' AND g.used_at IS NULL AND g.expires_at > now()), false) AS "canWrite",
              (SELECT max(a.created_at) FROM audit_logs a WHERE a.action = 'mcp.tool_call'
                 AND a.actor_id = g.staff_user_id AND a.context->>'clientId' = g.client_id) AS "lastUsedAt",
              (SELECT count(*)::int FROM audit_logs a WHERE a.action = 'mcp.tool_call'
                 AND a.actor_id = g.staff_user_id AND a.context->>'clientId' = g.client_id) AS "toolCalls"
       FROM mcp_oauth_grants g
       JOIN mcp_oauth_clients c ON c.client_id = g.client_id
       JOIN users u ON u.id = g.staff_user_id
       WHERE g.kind IN ('access', 'refresh')${where}
       GROUP BY g.client_id, c.info, g.staff_user_id, u.email) x
       ORDER BY x."liveSessions" > 0 DESC, x."lastUsedAt" DESC NULLS LAST, x."firstSeenAt" DESC`, params);
    return { enabled: !!base, mcpUrl: base ? `${base}/mcp` : null, role: req.staff.role, connections };
  }

  @Get('activity')
  async activity(@Req() req: StaffRequest, @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    const params: unknown[] = [Math.min(Math.max(limit, 1), 200)];
    const where = this.scope(req, 'a.actor_id', params);
    return this.db.query(
      `SELECT a.id, a.created_at AS "at", a.action = 'mcp.write' AS "isWrite", a.context->>'tool' AS tool, a.context->'args' AS args, a.context->>'email' AS "staffEmail",
              coalesce(c.info->>'client_name', a.context->>'clientId') AS "clientName"
       FROM audit_logs a LEFT JOIN mcp_oauth_clients c ON c.client_id = a.context->>'clientId'
       WHERE (a.action = 'mcp.write' OR (a.action = 'mcp.tool_call' AND a.context->'args'->>'confirmCode' IS NULL))${where}
       ORDER BY a.created_at DESC LIMIT $1`, params);
  }

  /** What AI created or changed, who asked for it (the staff member signed in to that AI) and through which AI app; failed tries included. */
  @Get('changes')
  async changes(@Req() req: StaffRequest, @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number) {
    const params: unknown[] = [Math.min(Math.max(limit, 1), 500)];
    const where = this.scope(req, 'a.actor_id', params);
    return this.db.query(
      `SELECT a.id, a.created_at AS "at", a.context->>'tool' AS tool, a.context->>'summary' AS summary,
              a.entity_type AS "entityType", a.entity_id AS "entityId", a.context->>'adminUrl' AS "adminUrl",
              coalesce(a.context->'changes', '[]'::jsonb) AS changes, a.context->>'error' AS error,
              a.actor_id AS "staffUserId", coalesce(u.email, a.context->>'email') AS "staffEmail",
              coalesce(c.info->>'client_name', a.context->>'clientId') AS "clientName"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN mcp_oauth_clients c ON c.client_id = a.context->>'clientId'
       WHERE a.action = 'mcp.write'${where}
       ORDER BY a.created_at DESC LIMIT $1`, params);
  }

  /** Cut an AI client off: every live access + refresh token for that client/staff pair stops working now. */
  @Post(':clientId/revoke')
  @HttpCode(200)
  async revoke(@Req() req: StaffRequest, @Param('clientId') clientId: string, @Body() dto: RevokeConnectionDto) {
    const staffUserId = req.staff.role === 'admin' && dto.staffUserId ? dto.staffUserId : req.staff.userId;
    const [, revoked] = await this.db.query(
      `UPDATE mcp_oauth_grants SET used_at = now()
       WHERE client_id = $1 AND staff_user_id = $2 AND kind IN ('access', 'refresh') AND used_at IS NULL AND expires_at > now()`,
      [clientId.slice(0, 64), staffUserId]);
    return { revoked };
  }
}
