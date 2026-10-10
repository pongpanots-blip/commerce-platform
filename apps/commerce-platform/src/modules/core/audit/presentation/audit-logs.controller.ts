import { Controller, Get, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { PaginationQueryDto } from '../../../../shared-kernel/application/pagination.dto';

export class AuditLogQueryDto extends PaginationQueryDto {
  /** Prefix: "mcp." matches mcp.tool_call and mcp.write. */
  @IsOptional() @IsString() @MaxLength(64) action?: string;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
  /** ISO instants; `to` is exclusive. */
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  /** Also list reads (AI read tools, GET through the josh relay). Off: changes only. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() includeReads?: boolean;
}

/** Rows that only looked at data: they outnumber changes ~4:1 and would bury them. */
const READS = `(a.action = 'mcp.tool_call' OR (a.action = 'josh.admin-call.call' AND a.after->>'method' IS NOT DISTINCT FROM 'GET'))`;

const MAX_PAGE_SIZE = 100;

/** WHERE clause + params for the list and its count. Exported for the spec. */
export function auditLogFilter(q: AuditLogQueryDto): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts = ['a.deleted_at IS NULL'];
  if (!q.includeReads) parts.push(`NOT ${READS}`);
  const add = (sql: (p: string) => string, value: unknown) => { params.push(value); parts.push(sql(`$${params.length}`)); };
  if (q.action) add((p) => `starts_with(a.action, ${p})`, q.action);
  if (q.entityType) add((p) => `a.entity_type = ${p}`, q.entityType);
  if (q.entityId) add((p) => `a.entity_id = ${p}`, q.entityId);
  if (q.actorId) add((p) => `a.actor_id = ${p}`, q.actorId);
  if (q.from) add((p) => `a.created_at >= ${p}`, q.from);
  if (q.to) add((p) => `a.created_at < ${p}`, q.to);
  return { where: parts.join(' AND '), params };
}

/**
 * Who changed what, across every writer of audit_logs (staff accounts, josh actions, MCP, ERP simulator).
 * Admin only: rows carry staff emails and raw request arguments.
 */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async list(@Query() query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, MAX_PAGE_SIZE);
    const { where, params } = auditLogFilter(query);
    // ponytail: offset paging + count(*) without a created_at index; add the index (migration) when the table gets slow.
    const [items, [{ total }]] = await Promise.all([
      this.db.query(
        `SELECT a.id, a.created_at AS "at", a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
                a.actor_id AS "actorId", coalesce(u.email, a.context->>'email') AS "actorEmail",
                a.before, a.after, a.context
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE ${where}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize]),
      this.db.query(`SELECT count(*)::int AS total FROM audit_logs a WHERE ${where}`, params),
    ]);
    return { items, total, page, pageSize };
  }

  /** Values for the filter suggestions. */
  @Get('facets')
  async facets() {
    const [actions, entityTypes] = await Promise.all([
      this.db.query(`SELECT action AS value, count(*)::int AS count FROM audit_logs WHERE deleted_at IS NULL GROUP BY action ORDER BY count DESC LIMIT 200`),
      this.db.query(`SELECT entity_type AS value, count(*)::int AS count FROM audit_logs WHERE deleted_at IS NULL GROUP BY entity_type ORDER BY count DESC LIMIT 200`),
    ]);
    return { actions, entityTypes };
  }
}
