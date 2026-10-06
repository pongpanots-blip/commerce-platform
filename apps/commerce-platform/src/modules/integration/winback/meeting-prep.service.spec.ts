import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MeetingPrepService } from './meeting-prep.service';
import { WinbackMeetingSignal } from './winback.enums';

/** Minimal query-builder double: records the SQL fragments the service adds. */
function queryBuilderStub(rows: unknown[] = []) {
  const wheres: string[] = [];
  const params: Record<string, unknown> = {};
  const qb: Record<string, unknown> = {};
  const chain = (sql?: unknown, p?: Record<string, unknown>) => {
    if (typeof sql === 'string') wheres.push(sql);
    if (p) Object.assign(params, p);
    return qb;
  };
  Object.assign(qb, {
    wheres,
    params,
    select: () => qb,
    where: chain,
    andWhere: chain,
    orderBy: () => qb,
    addOrderBy: () => qb,
    take: () => qb,
    subQuery: () => qb,
    from: () => qb,
    getQuery: () => '(sub)',
    getMany: async () => rows,
    getOne: async () => rows[0] ?? null,
  });
  return qb as any;
}

function createService(overrides: Record<string, any> = {}) {
  const accounts = { createQueryBuilder: jest.fn(() => queryBuilderStub()) };
  const activities = { createQueryBuilder: jest.fn(() => queryBuilderStub()) };
  const stageHistory = {
    createQueryBuilder: jest.fn(() => queryBuilderStub()),
    find: jest.fn(async () => []),
  };
  const acks = {
    createQueryBuilder: jest.fn(() => queryBuilderStub()),
    query: jest.fn(async (_sql: string, params: unknown[]) => [
      {
        account_id: params[0],
        signal: params[1],
        subject_id: params[2],
        discussed_at: params[3],
      },
    ]),
  };
  const users = { find: jest.fn(async () => []) };

  const deps = { accounts, activities, stageHistory, acks, users, ...overrides };
  const service = new MeetingPrepService(
    deps.accounts as any,
    deps.activities as any,
    deps.stageHistory as any,
    deps.acks as any,
    deps.users as any,
  );
  return { service, ...deps };
}

describe('MeetingPrepService scope', () => {
  it('does not narrow by owner for a manager', async () => {
    const { service, accounts } = createService();
    await service.getLeadSignals({ salesUserId: 'mgr-1', isManager: true });

    const qb = accounts.createQueryBuilder.mock.results[0].value;
    expect(qb.wheres.join(' ')).not.toContain('assigned_sales_user_id');
  });

  it('limits a sales user to their own leads plus unassigned ones', async () => {
    const { service, accounts } = createService();
    await service.getLeadSignals({ salesUserId: 'sales-1', isManager: false });

    const qb = accounts.createQueryBuilder.mock.results[0].value;
    expect(qb.wheres.join(' ')).toContain(
      'a.assigned_sales_user_id = :me OR a.assigned_sales_user_id IS NULL',
    );
    expect(qb.params.me).toBe('sales-1');
  });

  it('lets a manager narrow to one rep', async () => {
    const { service, accounts } = createService();
    await service.getLeadSignals({
      salesUserId: 'mgr-1',
      isManager: true,
      requestedSalesUserId: 'sales-2',
    });

    const qb = accounts.createQueryBuilder.mock.results[0].value;
    expect(qb.params.requested).toBe('sales-2');
  });

  it('refuses a sales user asking for someone else', async () => {
    const { service } = createService();
    await expect(
      service.getLeadSignals({
        salesUserId: 'sales-1',
        isManager: false,
        requestedSalesUserId: 'sales-2',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('excludes closed leads', async () => {
    const { service, accounts } = createService();
    await service.getLeadSignals({ salesUserId: 'mgr-1', isManager: true });

    const qb = accounts.createQueryBuilder.mock.results[0].value;
    expect(qb.wheres.join(' ')).toContain('a.stage NOT IN (:...closed)');
    expect(qb.params.closed).toEqual(
      expect.arrayContaining(['won', 'lost', 'rejected', 'signed']),
    );
  });
});

describe('MeetingPrepService.acknowledge', () => {
  const base = {
    account_id: '11111111-1111-1111-1111-111111111111',
    discussed_at: '2026-09-08T10:15:00+07:00',
  };

  it('rejects a lead-level signal that carries a subject', async () => {
    const { service } = createService();
    await expect(
      service.acknowledge(
        { ...base, signal: WinbackMeetingSignal.NEVER_TOUCHED, subject_id: 'act-1' },
        'mgr-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an appointment signal with no subject', async () => {
    const { service } = createService();
    await expect(
      service.acknowledge(
        { ...base, signal: WinbackMeetingSignal.APPOINTMENT_UNLOGGED },
        'mgr-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a stage_stalled subject that is not a stage', async () => {
    const { service } = createService();
    await expect(
      service.acknowledge(
        { ...base, signal: WinbackMeetingSignal.STAGE_STALLED, subject_id: 'negotiating' },
        'mgr-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a valid new acknowledgement', async () => {
    const { service, acks } = createService();
    const result = await service.acknowledge(
      { ...base, signal: WinbackMeetingSignal.STAGE_STALLED, subject_id: 'negotiate' },
      'mgr-1',
    );

    expect(acks.query).toHaveBeenCalled();
    expect(result).toEqual({
      account_id: base.account_id,
      signal: 'stage_stalled',
      subject_id: 'negotiate',
      discussed_at: new Date(base.discussed_at),
    });
    // discussed_by is stored for audit, never returned.
    expect(result).not.toHaveProperty('discussed_by');
  });

  it('upserts in one statement so two managers cannot race', async () => {
    const { service, acks } = createService();
    await service.acknowledge(
      { ...base, signal: WinbackMeetingSignal.NEVER_TOUCHED },
      'mgr-1',
    );

    const [sql, params] = acks.query.mock.calls[0];
    // The conflict target must match the expression index; a plain
    // (account_id, signal, subject_id) target does not, because Postgres treats
    // NULL subjects as distinct and every acknowledgement would insert a row.
    expect(sql).toContain("ON CONFLICT (account_id, signal, COALESCE(subject_id, ''))");
    // GREATEST, so a late-arriving older acknowledgement cannot rewind the marker.
    expect(sql).toContain('GREATEST(winback_meeting_ack.discussed_at, EXCLUDED.discussed_at)');
    expect(params).toEqual([
      base.account_id,
      'never_touched',
      null,
      new Date(base.discussed_at),
      'mgr-1',
    ]);
  });
});

describe('MeetingPrepService per-rep stage timing', () => {
  it('asks only for the caller when the caller is a sales user', async () => {
    const { service, users } = createService();
    await service.getLeadSignals({ salesUserId: 'sales-1', isManager: false });

    // No rep lookup at all — a sales user may only ever see their own figures.
    expect(users.find).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ is_active: true }) }),
    );
  });

  it('resolves every active rep for a manager', async () => {
    const { service, users } = createService();
    await service.getLeadSignals({ salesUserId: 'mgr-1', isManager: true });

    expect(users.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ is_active: true }),
        select: ['id'],
      }),
    );
  });
});
