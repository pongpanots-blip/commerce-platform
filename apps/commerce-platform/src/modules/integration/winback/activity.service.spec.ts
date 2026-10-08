import { Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import { ActivityService } from './activity.service';
import { CheckoutDto } from './dto/create-activity.dto';

function makeAccount(overrides: Partial<WinbackAccount> = {}): WinbackAccount {
  return {
    id: 'acc1',
    stage: 'contacted',
    activity_count: 0,
    visit_count: 0,
    last_activity_at: null,
    ...overrides,
  } as WinbackAccount;
}

function makeActivitiesRepo(activity: WinbackActivity) {
  const created: WinbackActivity[] = [];
  return {
    findOne: jest.fn(async (opts: { where: { status?: string } }) =>
      opts.where.status === 'in_progress' ? null : activity,
    ),
    save: jest.fn(async (a: WinbackActivity) => a),
    create: jest.fn((partial: Partial<WinbackActivity>) => {
      const row = { id: `new-${created.length}`, photo_urls: [], ...partial } as WinbackActivity;
      created.push(row);
      return row;
    }),
    __created: created,
  } as unknown as jest.Mocked<Repository<WinbackActivity>> & { __created: WinbackActivity[] };
}

function makeAccountsRepo(account: WinbackAccount) {
  return {
    findOne: jest.fn(async () => account),
    save: jest.fn(async (a: WinbackAccount) => a),
  } as unknown as jest.Mocked<Repository<WinbackAccount>>;
}

function makeStageHistoryRepo() {
  return {
    save: jest.fn(async (a: WinbackStageHistory) => a),
    create: jest.fn((partial: Partial<WinbackStageHistory>) => partial as WinbackStageHistory),
  } as unknown as jest.Mocked<Repository<WinbackStageHistory>>;
}

describe('ActivityService checkin', () => {
  it('sets status in_progress and does not bump activity_count/visit_count', async () => {
    const account = makeAccount();
    const activities = makeActivitiesRepo({} as WinbackActivity);
    const accounts = makeAccountsRepo(account);
    const stageHistory = makeStageHistoryRepo();
    const service = new ActivityService(activities, accounts, stageHistory);

    const created = await service.checkin('acc1', 'sales1', { type: 'store_visit' });

    expect(created.status).toBe('in_progress');
    expect(account.activity_count).toBe(0);
    expect(account.visit_count).toBe(0);
  });

  it('returns the existing open in_progress activity instead of creating a new one', async () => {
    const account = makeAccount();
    const open = { id: 'open1', status: 'in_progress', lat: null, lng: null } as WinbackActivity;
    const activities = {
      findOne: jest.fn(async () => open),
      save: jest.fn(async (a: WinbackActivity) => a),
      create: jest.fn(),
    } as unknown as jest.Mocked<Repository<WinbackActivity>>;
    const accounts = makeAccountsRepo(account);
    const stageHistory = makeStageHistoryRepo();
    const service = new ActivityService(activities, accounts, stageHistory);

    const result = await service.checkin('acc1', 'sales1', { type: 'store_visit' });

    expect(result).toBe(open);
    expect((activities.create as jest.Mock)).not.toHaveBeenCalled();
  });

  it('stores the check-in GPS fix with its accuracy', async () => {
    const activities = makeActivitiesRepo({} as WinbackActivity);
    const service = new ActivityService(activities, makeAccountsRepo(makeAccount()), makeStageHistoryRepo());

    const created = await service.checkin('acc1', 'sales1', {
      type: 'store_visit',
      lat: 13.746,
      lng: 100.535,
      accuracy_m: 12.5,
    });

    expect(created).toMatchObject({ lat: 13.746, lng: 100.535, checkin_accuracy_m: 12.5 });
  });
});

describe('ActivityService checkout', () => {
  it('applies outcome, reuses the store_visit row, and increments counters once per type', async () => {
    const account = makeAccount({ activity_count: 5, visit_count: 2 });
    const openActivity = {
      id: 'act1',
      account_id: 'acc1',
      sales_user_id: 'sales1',
      type: 'store_visit',
      status: 'in_progress',
      checkin_at: new Date('2026-07-21T03:00:00Z'),
      checkout_at: null,
      photo_urls: [],
      lat: 13.7,
      lng: 100.5,
    } as unknown as WinbackActivity;
    const activities = makeActivitiesRepo(openActivity);
    const accounts = makeAccountsRepo(account);
    const stageHistory = makeStageHistoryRepo();
    const service = new ActivityService(activities, accounts, stageHistory);

    const dto: CheckoutDto = { outcome: 'interested', types: ['store_visit', 'call'] };
    const result = await service.checkout('act1', dto);

    expect(result.contact_done).toBe(2);
    expect(openActivity.status).toBe('done');
    expect(openActivity.type).toBe('store_visit');
    expect(openActivity.outcome).toBe('interested');
    expect(account.activity_count).toBe(7);
    expect(account.visit_count).toBe(3);
    expect(activities.create).toHaveBeenCalledTimes(1);
    expect((activities as unknown as { __created: WinbackActivity[] }).__created[0].type).toBe(
      'call',
    );
  });

  it('repurposes the store_visit row as call instead of double-counting when only a non-visit type is selected', async () => {
    const account = makeAccount({ activity_count: 5, visit_count: 2 });
    const openActivity = {
      id: 'act1',
      account_id: 'acc1',
      sales_user_id: 'sales1',
      type: 'store_visit',
      status: 'in_progress',
      checkin_at: new Date('2026-07-21T03:00:00Z'),
      checkout_at: null,
      photo_urls: [],
      lat: 13.7,
      lng: 100.5,
    } as unknown as WinbackActivity;
    const activities = makeActivitiesRepo(openActivity);
    const accounts = makeAccountsRepo(account);
    const stageHistory = makeStageHistoryRepo();
    const service = new ActivityService(activities, accounts, stageHistory);

    const dto: CheckoutDto = { outcome: 'interested', types: ['call'] };
    const result = await service.checkout('act1', dto);

    expect(result.contact_done).toBe(1);
    expect(openActivity.status).toBe('done');
    expect(openActivity.type).toBe('call');
    expect(account.activity_count).toBe(6);
    expect(account.visit_count).toBe(2);
    expect(activities.create).not.toHaveBeenCalled();
  });

  it('stores the check-out GPS fix, and keeps it off the row when the app sends none', async () => {
    const open = () =>
      ({
        id: 'act1',
        account_id: 'acc1',
        sales_user_id: 'sales1',
        type: 'store_visit',
        status: 'in_progress',
        checkin_at: new Date('2026-07-21T03:00:00Z'),
        checkout_at: null,
        photo_urls: [],
        lat: 13.7,
        lng: 100.5,
        checkout_lat: null,
        checkout_lng: null,
        checkout_accuracy_m: null,
      }) as unknown as WinbackActivity;

    const withGps = open();
    await new ActivityService(makeActivitiesRepo(withGps), makeAccountsRepo(makeAccount()), makeStageHistoryRepo())
      .checkout('act1', { outcome: 'interested', types: ['store_visit'], lat: 13.71, lng: 100.51, accuracy_m: 8 });
    expect(withGps).toMatchObject({ checkout_lat: 13.71, checkout_lng: 100.51, checkout_accuracy_m: 8 });

    const without = open();
    await new ActivityService(makeActivitiesRepo(without), makeAccountsRepo(makeAccount()), makeStageHistoryRepo())
      .checkout('act1', { outcome: 'interested', types: ['store_visit'] });
    expect(without).toMatchObject({ checkout_lat: null, checkout_lng: null, checkout_accuracy_m: null });
  });

  it('rejects checkout when the activity has not been checked in', async () => {
    const openActivity = {
      id: 'act1',
      status: 'in_progress',
      checkin_at: null,
      checkout_at: null,
    } as unknown as WinbackActivity;
    const activities = makeActivitiesRepo(openActivity);
    const accounts = makeAccountsRepo(makeAccount());
    const stageHistory = makeStageHistoryRepo();
    const service = new ActivityService(activities, accounts, stageHistory);

    await expect(
      service.checkout('act1', { outcome: 'interested', types: ['call'] }),
    ).rejects.toThrow('activity has no check-in');
  });
});
