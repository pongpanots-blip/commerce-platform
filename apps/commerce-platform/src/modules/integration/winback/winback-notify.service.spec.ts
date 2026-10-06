import { WinbackNotifyService, LEAD_AGING_DAYS } from './winback-notify.service';

const NOW = new Date('2026-09-07T02:00:00Z'); // 09:00 Bangkok

function build(opts: { activities?: any[]; accounts?: any[]; aging?: any[] } = {}) {
  const activities = {
    find: jest.fn(async () => opts.activities ?? []),
    update: jest.fn(async () => ({ affected: 1 })),
  } as any;
  const accounts = {
    find: jest.fn(async () => opts.accounts ?? []),
    update: jest.fn(async () => ({ affected: 1 })),
  } as any;
  const qb: any = {
    andWhere: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getMany: jest.fn(async () => opts.aging ?? []),
  };
  const winback = { unworkedLeadsQuery: jest.fn(() => qb) } as any;
  const notifications = { dispatch: jest.fn(async () => []) } as any;
  const service = new WinbackNotifyService(accounts, activities, winback, notifications);
  return { service, activities, accounts, qb, winback, notifications };
}

describe('WinbackNotifyService.notifyAppointmentsDue', () => {
  const activity = {
    id: 'act-1',
    account_id: 'acc-1',
    sales_user_id: 'sale-1',
    type: 'visit',
    status: 'planned',
    scheduled_at: new Date('2026-09-07T02:45:00Z'),
    reminded_at: null,
  };
  const account = { id: 'acc-1', customer_code: 'WB-01', display_name: 'ร้าน A', restaurant_name: 'ร้าน A' };

  it('reminds the rep and marks the activity so the next tick skips it', async () => {
    const { service, activities, notifications } = build({ activities: [activity], accounts: [account] });
    const sent = await service.notifyAppointmentsDue(NOW);
    expect(sent).toBe(1);
    expect(notifications.dispatch).toHaveBeenCalledWith({
      userId: 'sale-1',
      type: 'winback_appointment_due',
      category: 'winback',
      dedupeKey: 'winback_appointment_due:act-1',
      data: {
        activity_id: 'act-1',
        activity_type: 'visit',
        account_id: 'acc-1',
        customer_code: 'WB-01',
        restaurant_name: 'ร้าน A',
        scheduled_at: '2026-09-07T02:45:00.000Z',
        scheduled_time: '09:45',
      },
    });
    expect(activities.update).toHaveBeenCalledWith('act-1', { reminded_at: NOW });
  });

  it('queries only planned, un-reminded activities inside the 60-minute window', async () => {
    const { service, activities } = build();
    await service.notifyAppointmentsDue(NOW);
    const where = activities.find.mock.calls[0][0].where;
    expect(where.status).toBe('planned');
    expect(where.scheduled_at._value).toEqual([NOW, new Date('2026-09-07T03:00:00Z')]);
  });

  it('leaves the activity unmarked when dispatch fails, so it is retried next tick', async () => {
    const { service, activities, notifications } = build({ activities: [activity], accounts: [account] });
    notifications.dispatch.mockRejectedValueOnce(new Error('down'));
    expect(await service.notifyAppointmentsDue(NOW)).toBe(0);
    expect(activities.update).not.toHaveBeenCalled();
  });
});

describe('WinbackNotifyService.notifyAgingLeads', () => {
  const lead = {
    id: 'acc-9',
    customer_code: 'WB-09',
    display_name: 'ร้าน B',
    restaurant_name: null,
    assigned_sales_user_id: 'sale-2',
    create_date: new Date('2026-09-02T02:00:00Z'),
  };

  it('notifies the owner with the age in days and stamps aging_notified_at', async () => {
    const { service, accounts, notifications, winback, qb } = build({ aging: [lead] });
    expect(await service.notifyAgingLeads(NOW)).toBe(1);
    expect(winback.unworkedLeadsQuery).toHaveBeenCalledWith(LEAD_AGING_DAYS, NOW);
    expect(qb.andWhere).toHaveBeenCalledWith('a.assigned_sales_user_id IS NOT NULL');
    expect(notifications.dispatch).toHaveBeenCalledWith({
      userId: 'sale-2',
      type: 'winback_lead_aging',
      category: 'winback',
      dedupeKey: 'winback_lead_aging:acc-9:2026-09-07',
      data: { account_id: 'acc-9', customer_code: 'WB-09', restaurant_name: 'ร้าน B', days_as_lead: 5 },
    });
    expect(accounts.update).toHaveBeenCalledWith('acc-9', { aging_notified_at: NOW });
  });

  it('only re-notifies after another aging period has passed', async () => {
    const { service, qb } = build();
    await service.notifyAgingLeads(NOW);
    const repeatClause = qb.andWhere.mock.calls.find((c: any[]) => String(c[0]).includes('aging_notified_at'));
    expect(repeatClause[1].repeatCutoff).toEqual(new Date('2026-09-04T02:00:00Z'));
  });
});

describe('WinbackNotifyService.notifyDailyDigest', () => {
  const AT_18 = new Date('2026-09-07T11:00:00Z'); // 18:00 Bangkok
  const todayPlanned = (id: string, user: string, hourUtc: number) => ({
    id, sales_user_id: user, status: 'planned', scheduled_at: new Date(`2026-09-07T${String(hourUtc).padStart(2, '0')}:00:00Z`),
  });
  const tomorrow = (id: string, user: string, status = 'planned') => ({
    id, sales_user_id: user, status, scheduled_at: new Date('2026-09-08T03:00:00Z'),
  });

  function buildDigest(unlogged: any[], tomorrowRows: any[]) {
    const { service, activities, notifications } = build();
    activities.find
      .mockImplementationOnce(async () => unlogged)
      .mockImplementationOnce(async () => tomorrowRows);
    return { service, activities, notifications };
  }

  it('sends one digest per rep with both counts, and stays silent for reps with nothing', async () => {
    const { service, notifications } = buildDigest(
      [todayPlanned('a1', 'sale-1', 2), todayPlanned('a2', 'sale-1', 5)],
      [tomorrow('b1', 'sale-1'), tomorrow('b2', 'sale-2'), tomorrow('b3', 'sale-2', 'cancelled')],
    );
    expect(await service.notifyDailyDigest(AT_18)).toBe(2);
    expect(notifications.dispatch).toHaveBeenCalledWith({
      userId: 'sale-1',
      type: 'winback_daily_digest',
      category: 'winback',
      dedupeKey: 'winback_daily_digest:sale-1:2026-09-07',
      data: { unlogged_count: 2, tomorrow_count: 1, date: '2026-09-07' },
    });
    // cancelled tomorrow appointment is not counted; sale-2 still has one
    expect(notifications.dispatch.mock.calls[1][0].data).toEqual({ unlogged_count: 0, tomorrow_count: 1, date: '2026-09-07' });
  });

  it('queries today from Bangkok midnight up to now, and tomorrow as the next Bangkok day', async () => {
    const { service, activities } = buildDigest([], []);
    await service.notifyDailyDigest(AT_18);
    const todayWhere = activities.find.mock.calls[0][0].where;
    const tomorrowWhere = activities.find.mock.calls[1][0].where;
    expect(todayWhere.status).toBe('planned');
    expect(todayWhere.scheduled_at._value).toEqual([new Date('2026-09-06T17:00:00Z'), AT_18]);
    expect(tomorrowWhere.scheduled_at._value).toEqual([new Date('2026-09-07T17:00:00Z'), new Date('2026-09-08T17:00:00Z')]);
  });

  it('sends nothing when no rep has either count', async () => {
    const { service, notifications } = buildDigest([], []);
    expect(await service.notifyDailyDigest(AT_18)).toBe(0);
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });
});
