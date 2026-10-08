import {
  appointmentEndError,
  bangkokDay,
  bangkokToday,
  customerState,
  matchesOpportunityFilter,
  Opportunity,
  OpportunityPlaceRow,
  pageOpportunities,
  parseSpendRange,
  placeToOpportunity,
  quoteMoveError,
  quoteStatusAt,
  revenueContext,
  salesPriorityScore,
  segmentForCategory,
  signalActionApplies,
  signalVisible,
  toCatalogProduct,
  toRevenueSignal,
} from './app-gaps.helpers';
import { WinbackAccount } from './entities/winback-account.entity';
import { WorklistItem } from './worklist.helpers';
import { WinbackHealth, WinbackSignalStatus, WinbackStage } from './winback.enums';

function place(over: Partial<OpportunityPlaceRow> = {}): OpportunityPlaceRow {
  return {
    id: 'p1',
    name_th: 'ร้านวัฒนา',
    name_en: 'Watthana',
    district: 'วัฒนา',
    raw_category: 'Japanese Restaurant',
    rating: '4.60',
    review_count: 320,
    price_range: '฿400–800',
    enriched_at: '2026-10-01T00:00:00Z',
    winback_account_id: null,
    ...over,
  };
}

const worklistItem: WorklistItem = {
  id: 'acc-1',
  customer_code: 'GNA1',
  display_name: 'ร้าน A',
  signal_type: 'reactivate',
  priority: 91,
  reasons: ['ไม่ได้สั่ง 214 วัน'],
  recommended_action: 'visit',
  last_order_at: new Date('2026-03-08T00:00:00Z'),
  inactive_days: 214,
  delay_ratio: 11.9,
  median_reorder_interval_days: 18,
  avg_monthly_revenue: 180000,
  winnable: true,
  province: null,
};

describe('bangkok dates', () => {
  it('reads the calendar day in Bangkok (UTC+7)', () => {
    expect(bangkokToday(new Date('2026-10-08T16:59:59Z'))).toBe('2026-10-08');
    expect(bangkokToday(new Date('2026-10-08T17:00:00Z'))).toBe('2026-10-09');
    expect(bangkokDay('2026-10-08')).toBe('2026-10-08');
    expect(bangkokDay('2026-10-08T18:00:00Z')).toBe('2026-10-09');
  });
});

describe('opportunity mapping', () => {
  it('parses explicit spend numbers only; tier text is not guessed', () => {
    expect(parseSpendRange('฿400–800')).toEqual({ min: 400, max: 800 });
    expect(parseSpendRange('฿1,000+')).toEqual({ min: 1000, max: null });
    expect(parseSpendRange('฿฿')).toEqual({ min: null, max: null });
    expect(parseSpendRange('$$')).toEqual({ min: null, max: null });
    expect(parseSpendRange(null)).toEqual({ min: null, max: null });
  });

  it('maps a segment from the category text, null when no rule matches', () => {
    expect(segmentForCategory('Sushi Bar')).toBe('japanese_premium');
    expect(segmentForCategory('Steakhouse')).toBe('steakhouse');
    expect(segmentForCategory('Coffee Shop')).toBe('bakery_cafe');
    expect(segmentForCategory('Thai Restaurant')).toBeNull();
    expect(segmentForCategory(null)).toBeNull();
  });

  it('scores priority from rating + reviews, null until enriched', () => {
    expect(salesPriorityScore(5, 500, true)).toBe(100);
    expect(salesPriorityScore(4.6, 320, true)).toBe(81);
    expect(salesPriorityScore(4.6, 320, false)).toBeNull();
    expect(salesPriorityScore(null, 320, true)).toBeNull();
  });

  it('builds an opportunity with province from the district and null for scores it has no source for', () => {
    const o = placeToOpportunity(place());
    expect(o).toMatchObject({
      id: 'p1',
      name: 'ร้านวัฒนา',
      province_code: 'TH-10',
      province_name: 'กรุงเทพมหานคร',
      restaurant_segment: 'japanese_premium',
      spend_min: 400,
      spend_max: 800,
      sales_priority_score: 81,
      premium_fit_score: null,
      road_distance_km: null,
      delivery_cost_ratio: null,
      enrichment_status: 'enriched',
      converted_to_winback: false,
    });
    expect(placeToOpportunity(place({ winback_account_id: 'acc-9' }))).toMatchObject({
      converted_to_winback: true,
      winback_account_id: 'acc-9',
    });
    expect(placeToOpportunity(place({ enriched_at: null })).enrichment_status).toBe('enriching');
  });

  it('skips a threshold the row has no value for, and never lists converted rows', () => {
    const o = placeToOpportunity(place());
    expect(matchesOpportunityFilter(o, { min_premium_fit: 80, max_road_km: 10 })).toBe(true);
    expect(matchesOpportunityFilter(o, { min_spend: 500 })).toBe(false);
    expect(matchesOpportunityFilter(o, { province_codes: ['10'] })).toBe(true);
    expect(matchesOpportunityFilter(o, { province_codes: ['TH-50'] })).toBe(false);
    expect(matchesOpportunityFilter(o, { segments: ['french'] })).toBe(false);
    expect(matchesOpportunityFilter(o, { search: 'japanese' })).toBe(true);
    expect(matchesOpportunityFilter({ ...o, converted_to_winback: true }, {})).toBe(false);
  });

  it('splits tabs, counts all three and pages the chosen one by priority', () => {
    const rows: Opportunity[] = [
      placeToOpportunity(place({ id: 'a', rating: 3 })),
      placeToOpportunity(place({ id: 'b', rating: 5 })),
      placeToOpportunity(place({ id: 'c', price_range: null })),
      { ...placeToOpportunity(place({ id: 'd' })), road_distance_km: 12 },
    ];
    const page = pageOpportunities(rows, { tab: 'recommended', page: 1, limit: 2 });
    expect(page.counts).toEqual({ recommended: 3, near_warehouse: 1, needs_enrich: 1 });
    expect(page.pagination).toEqual({ page: 1, limit: 2, total: 3 });
    expect(page.items.map((o) => o.id)).toEqual(['b', 'd']);
    expect(pageOpportunities(rows, { tab: 'needs_enrich' }).items.map((o) => o.id)).toEqual(['c']);
    expect(pageOpportunities(rows, { tab: 'near_warehouse' }).items.map((o) => o.id)).toEqual(['d']);
  });
});

describe('revenue signals', () => {
  const action = { status: WinbackSignalStatus.COMPLETED, outcome: 'follow_up', acted_at: '2026-10-01T00:00:00Z' };

  it('an action stops applying once the customer orders after it', () => {
    expect(signalActionApplies(action, '2026-09-01T00:00:00Z')).toBe(true);
    expect(signalActionApplies(action, null)).toBe(true);
    expect(signalActionApplies(action, '2026-10-02T00:00:00Z')).toBe(false);
    expect(signalActionApplies(undefined, null)).toBe(false);
  });

  it('overlays the action on the worklist item', () => {
    expect(toRevenueSignal(worklistItem, null)).toMatchObject({ id: 'acc-1', status: 'open', outcome: null, snoozed_until: null });
    expect(toRevenueSignal(worklistItem, action)).toMatchObject({ status: 'completed', outcome: 'follow_up' });
  });

  it('status=open hides rows snoozed into the future', () => {
    const snoozed = toRevenueSignal(worklistItem, { status: WinbackSignalStatus.OPEN, snoozed_until: '2026-10-10', acted_at: 'x' });
    expect(signalVisible(snoozed, 'open', '2026-10-08')).toBe(false);
    expect(signalVisible(snoozed, 'open', '2026-10-10')).toBe(true);
    expect(signalVisible(snoozed, undefined, '2026-10-08')).toBe(true);
    expect(signalVisible(toRevenueSignal(worklistItem, action), 'open', '2026-10-08')).toBe(false);
  });

  it('customer state from health / stage', () => {
    expect(customerState({ health: WinbackHealth.DORMANT, stage: WinbackStage.INACTIVE_POOL })).toBe('dormant');
    expect(customerState({ health: WinbackHealth.WATCH, stage: WinbackStage.CONTACTED })).toBe('at_risk');
    expect(customerState({ health: WinbackHealth.REACTIVATING, stage: WinbackStage.CONTACTED })).toBe('reactivated');
    expect(customerState({ health: WinbackHealth.ACTIVE_AGAIN, stage: WinbackStage.WON })).toBe('active');
    expect(customerState({ health: WinbackHealth.DORMANT, stage: WinbackStage.LOST })).toBe('lost');
  });

  it('revenue context: {} without order history; at-risk revenue only when not active', () => {
    const account = {
      health: WinbackHealth.DORMANT,
      stage: WinbackStage.INACTIVE_POOL,
      last_order_at: new Date('2026-09-28T00:00:00Z'),
      avg_monthly_revenue: '180000.00',
      delay_ratio: '2.5',
      median_reorder_interval_days: 4,
    } as unknown as WinbackAccount;
    expect(revenueContext({ ...account, last_order_at: null } as WinbackAccount, 'call')).toEqual({});
    expect(revenueContext(account, 'call', new Date('2026-10-08T00:00:00Z'))).toEqual({
      customer_state: 'dormant',
      last_order_at: account.last_order_at,
      days_since_last_order: 10,
      median_reorder_interval_days: 4,
      delay_ratio: 2.5,
      historical_monthly_revenue: 180000,
      revenue_at_risk: 180000,
      top_products: [],
      recommended_action: 'call',
    });
    const active = { ...account, health: WinbackHealth.ACTIVE_AGAIN } as WinbackAccount;
    expect(revenueContext(active, null).revenue_at_risk).toBeNull();
  });
});

describe('quotes', () => {
  it('expired is read off valid_until; accepted/declined never expire', () => {
    expect(quoteStatusAt('follow_up', '2026-10-07', '2026-10-08')).toBe('expired');
    expect(quoteStatusAt('follow_up', '2026-10-08', '2026-10-08')).toBe('follow_up');
    expect(quoteStatusAt('accepted', '2026-01-01', '2026-10-08')).toBe('accepted');
  });

  it('allows only the review flow, with approve / return for managers', () => {
    expect(quoteMoveError('draft', 'in_review', false)).toBeNull();
    expect(quoteMoveError('in_review', 'follow_up', true)).toBeNull();
    expect(quoteMoveError('in_review', 'draft', true)).toBeNull();
    expect(quoteMoveError('in_review', 'follow_up', false)).toMatch(/^เฉพาะ manager/);
    expect(quoteMoveError('follow_up', 'accepted', false)).toBeNull();
    expect(quoteMoveError('draft', 'accepted', true)).not.toBeNull();
    expect(quoteMoveError('expired', 'follow_up', true)).not.toBeNull();
    expect(quoteMoveError('accepted', 'declined', true)).not.toBeNull();
  });
});

describe('appointment end', () => {
  const start = new Date('2026-10-08T03:00:00Z');
  it('must be after the start and at most 24 h later', () => {
    expect(appointmentEndError(start, null)).toBeNull();
    expect(appointmentEndError(start, '2026-10-08T04:00:00Z')).toBeNull();
    expect(appointmentEndError(start, '2026-10-08T03:00:00Z')).not.toBeNull();
    expect(appointmentEndError(start, '2026-10-09T03:00:01Z')).not.toBeNull();
    expect(appointmentEndError(null, '2026-10-08T04:00:00Z')).not.toBeNull();
  });
});

describe('catalog product', () => {
  it('names from th → en → sku and exposes the selling unit with its price', () => {
    const row = {
      id: 'x', sku: 'RIB20', name_th: null, name_en: 'Ribeye', brand_name: null, category_name: null,
      selling_unit: 'KG', selling_unit_price: '912.50', image_url: null,
    };
    expect(toCatalogProduct(row)).toEqual({
      id: 'x', sku: 'RIB20', name: 'Ribeye', name_en: 'Ribeye', brand_name: null, category_name: null, image_url: null,
      units: [{ id: 'selling', label: 'KG', unit_price: 912.5 }],
    });
    expect(toCatalogProduct({ ...row, name_en: null, selling_unit: null, selling_unit_price: null })).toMatchObject({
      name: 'RIB20',
      units: [{ id: 'selling', label: 'หน่วย', unit_price: null }],
    });
  });
});
