/**
 * `winback_account.assigned_at` answers "how long has THIS rep had it", so the
 * clock has to restart on every owner change and stop whenever nobody owns the
 * lead. Assign, self-claim, reassign and release all go through
 * `LeadService.update`, so these pin the rule at that one place.
 */
import { Repository } from 'typeorm';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-copies.entity';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { JoshUser as User } from './josh-copies.entity';
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
    assigned_at: null,
    ...existing,
  } as WinbackAccount;
  const accounts = {
    findOne: jest.fn(async () => account),
    save: jest.fn(async (row: WinbackAccount) => row),
  } as unknown as jest.Mocked<Repository<WinbackAccount>>;
  const service = new LeadService(
    accounts,
    {} as Repository<WinbackContact>,
    {} as Repository<User>,
    {} as Repository<RestaurantPlace>,
    {} as MatchingService,
    { dispatch: jest.fn(async () => []) } as unknown as jest.Mocked<NotificationService>,
  );
  return { service, account };
}

const manager = { salesUserId: 'mgr-1', role: 'manager' };
const OLD = new Date('2026-01-01T00:00:00Z');

describe('LeadService.update → assigned_at', () => {
  it('starts the clock when a manager assigns an unowned lead', async () => {
    const { service } = build({});
    const saved = await service.update(
      'acc-1',
      { assigned_sales_user_id: 'sale-2' } as any,
      manager,
    );
    expect(saved.assigned_at).toBeInstanceOf(Date);
  });

  it('restarts the clock on reassignment to a different rep', async () => {
    const { service } = build({ assigned_sales_user_id: 'sale-1', assigned_at: OLD });
    const saved = await service.update(
      'acc-1',
      { assigned_sales_user_id: 'sale-2' } as any,
      manager,
    );
    expect(saved.assigned_at!.getTime()).toBeGreaterThan(OLD.getTime());
  });

  it('restarts it when a manager takes the lead for themselves', async () => {
    // Deliberate: they own it now, so the clock is theirs. No role exemption —
    // an exemption would make the field stop matching its own name.
    const { service } = build({ assigned_sales_user_id: 'sale-1', assigned_at: OLD });
    const saved = await service.update(
      'acc-1',
      { assigned_sales_user_id: 'mgr-1' } as any,
      manager,
    );
    expect(saved.assigned_at!.getTime()).toBeGreaterThan(OLD.getTime());
  });

  it('clears it when the lead goes back to the pool', async () => {
    const { service } = build({ assigned_sales_user_id: 'sale-1', assigned_at: OLD });
    const saved = await service.update(
      'acc-1',
      { assigned_sales_user_id: null } as any,
      manager,
    );
    expect(saved.assigned_at).toBeNull();
  });

  it('leaves it alone when the owner does not actually change', async () => {
    // Re-saving the same owner is not a handover; resetting here would make
    // every unrelated PATCH look like the rep just got the lead.
    const { service } = build({ assigned_sales_user_id: 'sale-1', assigned_at: OLD });
    const saved = await service.update(
      'acc-1',
      { assigned_sales_user_id: 'sale-1' } as any,
      manager,
    );
    expect(saved.assigned_at).toBe(OLD);
  });

  it('leaves it alone when the patch does not touch the owner at all', async () => {
    const { service } = build({ assigned_sales_user_id: 'sale-1', assigned_at: OLD });
    const saved = await service.update(
      'acc-1',
      { restaurant_name: 'ร้าน B' } as any,
      manager,
    );
    expect(saved.assigned_at).toBe(OLD);
  });

  it('does not resurrect a clock for a lead that stays unowned', async () => {
    const { service } = build({ assigned_sales_user_id: null, assigned_at: null });
    const saved = await service.update(
      'acc-1',
      { restaurant_name: 'ร้าน B' } as any,
      manager,
    );
    expect(saved.assigned_at).toBeNull();
  });
});
