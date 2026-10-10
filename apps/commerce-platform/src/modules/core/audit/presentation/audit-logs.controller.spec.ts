import { AuditLogsController, auditLogFilter } from './audit-logs.controller';

describe('audit log list', () => {
  it('builds numbered params in filter order and always hides soft-deleted rows', () => {
    const f = auditLogFilter({ includeReads: true, action: 'mcp.', actorId: 'a1', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    expect(f.where).toBe('a.deleted_at IS NULL AND starts_with(a.action, $1) AND a.actor_id = $2 AND a.created_at >= $3 AND a.created_at < $4');
    expect(f.params).toEqual(['mcp.', 'a1', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z']);
    expect(auditLogFilter({ includeReads: true })).toEqual({ where: 'a.deleted_at IS NULL', params: [] });
  });

  it('hides reads unless asked', () => {
    expect(auditLogFilter({}).where).toContain(`NOT (a.action = 'mcp.tool_call' OR (a.action = 'josh.admin-call.call' AND a.after->>'method' IS NOT DISTINCT FROM 'GET'))`);
  });

  it('pages after the filter params and caps page size', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => (sql.includes('count(*)') ? [{ total: 7 }] : []));
    const res = await new AuditLogsController({ query } as never).list({ entityType: 'staff_account', page: 3, pageSize: 500 });
    expect(query.mock.calls[0][1]).toEqual(['staff_account', 100, 200]);
    expect(query.mock.calls[0][0]).toContain('LIMIT $2 OFFSET $3');
    expect(res).toEqual({ items: [], total: 7, page: 3, pageSize: 100 });
  });
});
