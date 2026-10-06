import { Repository } from 'typeorm';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-replica-tables';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { JoshUser as User } from './josh-replica-tables';
import { LeadService } from './lead.service';
import { MatchingService } from './matching.service';
import { NotificationService } from './shared/notification.service';

function build(existing: Partial<WinbackAccount>) {
  const account = {
    id: 'acc-1',
    customer_code: 'WB-01',
    display_name: 'ร้าน A',
    restaurant_name: 'ร้าน A',
    assigned_sales_user_id: null,
    ...existing,
  } as WinbackAccount;
  const accounts = {
    findOne: jest.fn(async () => account),
    save: jest.fn(async (row: WinbackAccount) => row),
  } as unknown as jest.Mocked<Repository<WinbackAccount>>;
  const notifications = { dispatch: jest.fn(async () => []) } as unknown as jest.Mocked<NotificationService>;
  const service = new LeadService(
    accounts,
    {} as Repository<WinbackContact>,
    {} as Repository<User>,
    {} as Repository<RestaurantPlace>,
    {} as MatchingService,
    notifications,
  );
  return { service, notifications };
}

const manager = { salesUserId: 'mgr-1', role: 'manager' };

describe('LeadService.update → winback_lead_assigned', () => {
  it('notifies the new owner when a manager assigns the lead', async () => {
    const { service, notifications } = build({});
    await service.update('acc-1', { assigned_sales_user_id: 'sale-2' } as any, manager);
    expect(notifications.dispatch).toHaveBeenCalledWith({
      userId: 'sale-2',
      type: 'winback_lead_assigned',
      category: 'winback',
      data: {
        account_id: 'acc-1',
        customer_code: 'WB-01',
        restaurant_name: 'ร้าน A',
        assigned_by_sales_user_id: 'mgr-1',
      },
      dedupeKey: 'winback_lead_assigned:acc-1:sale-2',
    });
  });

  it('notifies when ownership moves from one rep to another', async () => {
    const { service, notifications } = build({ assigned_sales_user_id: 'sale-1' });
    await service.update('acc-1', { assigned_sales_user_id: 'sale-2' } as any, manager);
    expect(notifications.dispatch).toHaveBeenCalledTimes(1);
    expect(notifications.dispatch.mock.calls[0][0].userId).toBe('sale-2');
  });

  it('stays silent when a rep claims the lead for themselves', async () => {
    const { service, notifications } = build({});
    await service.update('acc-1', { assigned_sales_user_id: 'sale-1' } as any, {
      salesUserId: 'sale-1',
      role: 'sale',
    });
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('stays silent when the owner is unchanged, cleared, or not part of the patch', async () => {
    const same = build({ assigned_sales_user_id: 'sale-2' });
    await same.service.update('acc-1', { assigned_sales_user_id: 'sale-2' } as any, manager);
    const cleared = build({ assigned_sales_user_id: 'sale-2' });
    await cleared.service.update('acc-1', { assigned_sales_user_id: null } as any, manager);
    const untouched = build({ assigned_sales_user_id: 'sale-2' });
    await untouched.service.update('acc-1', { phone: '0812345678' } as any, manager);
    expect(same.notifications.dispatch).not.toHaveBeenCalled();
    expect(cleared.notifications.dispatch).not.toHaveBeenCalled();
    expect(untouched.notifications.dispatch).not.toHaveBeenCalled();
  });

  it('does not fail the update when dispatch throws', async () => {
    const { service, notifications } = build({});
    notifications.dispatch.mockRejectedValueOnce(new Error('onesignal down'));
    await expect(
      service.update('acc-1', { assigned_sales_user_id: 'sale-2' } as any, manager),
    ).resolves.toMatchObject({ assigned_sales_user_id: 'sale-2' });
  });
});
