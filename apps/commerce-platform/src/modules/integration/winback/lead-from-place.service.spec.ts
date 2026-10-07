import { Repository } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-copies.entity';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { JoshUser as User } from './josh-copies.entity';
import { LeadService } from './lead.service';
import { MatchingService } from './matching.service';
import { NotificationService } from './shared/notification.service';
import { WinbackLeadSource, WinbackLifecycle, WinbackStage } from './winback.enums';

const NOW = new Date('2026-08-19T12:00:00Z');

function restaurantPlace(overrides: Partial<RestaurantPlace> = {}): RestaurantPlace {
  return {
    id: 'place-1',
    name_th: 'ครัวทดสอบ',
    name_en: 'Test Kitchen',
    lat: 13.7563,
    lng: 100.5018,
    district: 'Watthana',
    raw_category: 'Thai',
    fsq_id: 'fsq-1',
    osm_id: null,
    google_place_id: null,
    source: 'fsq_os',
    rating: null,
    review_count: null,
    price_range: null,
    popular_times: null,
    opening_hours: null,
    dine_in: null,
    takeaway: null,
    delivery: null,
    enriched_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as RestaurantPlace;
}

describe('LeadService.createTmpFromRestaurantPlace', () => {
  it('creates a TMP lead linked to the restaurant place', async () => {
    const saved: WinbackAccount[] = [];
    const accounts = {
      findOne: jest.fn(async ({ where }: { where: { restaurant_place_id?: string } }) =>
        saved.find((row) => row.restaurant_place_id === where.restaurant_place_id) ?? null,
      ),
      create: jest.fn((row) => row),
      save: jest.fn(async (row: WinbackAccount) => {
        const stored = { ...row, id: 'lead-1' };
        saved.push(stored);
        return stored;
      }),
    } as unknown as jest.Mocked<Repository<WinbackAccount>>;

    const places = {
      findOne: jest.fn(async () => restaurantPlace()),
    } as unknown as jest.Mocked<Repository<RestaurantPlace>>;

    const service = new LeadService(
      accounts,
      {} as Repository<WinbackContact>,
      {} as Repository<User>,
      places,
      {} as MatchingService,
      {} as NotificationService,
    );

    const lead = await service.createTmpFromRestaurantPlace('sales-1', 'place-1');
    expect(lead.id).toBe('lead-1');
    expect(lead.restaurant_name).toBe('ครัวทดสอบ');
    expect(lead.lead_source).toBe(WinbackLeadSource.MARKET_EXPLORER);
    expect(lead.lifecycle).toBe(WinbackLifecycle.TMP);
    expect(lead.stage).toBe(WinbackStage.PROSPECT);
    expect(lead.restaurant_place_id).toBe('place-1');
    expect(lead.assigned_sales_user_id).toBeNull();
    expect(lead.created_by_sales_user_id).toBe('sales-1');
  });

  it('rejects unknown place id', async () => {
    const places = {
      findOne: jest.fn(async () => null),
    } as unknown as jest.Mocked<Repository<RestaurantPlace>>;

    const service = new LeadService(
      {} as Repository<WinbackAccount>,
      {} as Repository<WinbackContact>,
      {} as Repository<User>,
      places,
      {} as MatchingService,
      {} as NotificationService,
    );

    await expect(
      service.createTmpFromRestaurantPlace('sales-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate place sourcing', async () => {
    const places = {
      findOne: jest.fn(async () => restaurantPlace()),
    } as unknown as jest.Mocked<Repository<RestaurantPlace>>;

    const accounts = {
      findOne: jest.fn(async () => ({ id: 'lead-old', customer_code: 'TMP-OLD' })),
    } as unknown as jest.Mocked<Repository<WinbackAccount>>;

    const service = new LeadService(
      accounts,
      {} as Repository<WinbackContact>,
      {} as Repository<User>,
      places,
      {} as MatchingService,
      {} as NotificationService,
    );

    await expect(
      service.createTmpFromRestaurantPlace('sales-1', 'place-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
