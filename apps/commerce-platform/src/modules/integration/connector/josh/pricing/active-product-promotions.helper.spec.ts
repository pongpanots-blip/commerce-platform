import {
  formatPromotionBadgeText,
  isMechanicSoldOut,
  loadActivePromotionsByProductIds,
  loadHiddenTargetedMechanicIds,
  loadMechanicOwnersByProductIds,
  loadMechanicPricingByProductIds,
  mechanicAudienceAllows,
  promotionValueFromSkuItem,
} from './active-product-promotions.helper';

function makeRepoMap(repos: Record<string, unknown>) {
  return {
    getRepository: (entity: { name?: string } | Function) => {
      const name =
        typeof entity === 'function'
          ? entity.name
          : (entity as { name?: string }).name;
      const repo = repos[name ?? ''];
      if (!repo) {
        throw new Error(`Missing mock repo for ${name}`);
      }
      return repo;
    },
  };
}

function qbResult<T>(rows: T[]) {
  const qb = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
}

describe('loadActivePromotionsByProductIds', () => {
  const at = new Date('2026-08-15');

  it('returns all active promotions newest first', async () => {
    const skuItems = [
      {
        id: 'item-newer',
        product_inventory_id: 'inv-1',
        badge_text: null,
        value: {
          type: 'bogo',
          buy_qty: 1,
          get_qty: 1,
          get_discount_percent: 100,
        },
        quantity_rules: [],
        promotionMechanic: {
          audience: 'all',
          id: 'newer',
          name: 'August BOGO',
          is_active: true,
          start_date: new Date('2026-08-01'),
          end_date: new Date('2026-08-31'),
          badge_text: null,
        },
      },
      {
        id: 'item-older',
        product_inventory_id: 'inv-1',
        badge_text: null,
        value: { type: 'percentage', percent: 10 },
        quantity_rules: [],
        promotionMechanic: {
          audience: 'all',
          id: 'older',
          name: 'July Percent',
          is_active: true,
          start_date: new Date('2026-07-01'),
          end_date: new Date('2026-08-31'),
          badge_text: null,
        },
      },
    ];
    const pages = [
      {
        slug: 'beef-aug',
        promotion_mechanic_id: 'newer',
        campaign_id: null,
      },
    ];

    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult(skuItems),
      PromotionPage: qbResult(pages),
    });

    const map = await loadActivePromotionsByProductIds(
      dataSource as any,
      ['inv-1'],
      null,
      at,
    );
    const list = map.get('inv-1') ?? [];

    expect(list).toHaveLength(2);
    expect(list[0].mechanic_id).toBe('newer');
    expect(list[0].badge_text).toBe('ซื้อ 1 แถม 1');
    expect(list[0].page_slug).toBe('beef-aug');
    expect(list[1].mechanic_id).toBe('older');
    expect(list[1].page_slug).toBeNull();
  });

  it('excludes promotions outside active date range', async () => {
    const skuItems = [
      {
        id: 'item-expired',
        product_inventory_id: 'inv-1',
        badge_text: null,
        value: { type: 'percentage', percent: 20 },
        quantity_rules: [],
        promotionMechanic: {
          audience: 'all',
          id: 'expired',
          name: 'Expired Promo',
          is_active: true,
          start_date: new Date('2026-06-01'),
          end_date: new Date('2026-07-31'),
          badge_text: null,
        },
      },
      {
        id: 'item-active',
        product_inventory_id: 'inv-1',
        badge_text: null,
        value: { type: 'percentage', percent: 5 },
        quantity_rules: [],
        promotionMechanic: {
          audience: 'all',
          id: 'active',
          name: 'Active Promo',
          is_active: true,
          start_date: new Date('2026-08-01'),
          end_date: new Date('2026-08-31'),
          badge_text: null,
        },
      },
    ];

    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult(skuItems),
      PromotionPage: qbResult([]),
    });

    const map = await loadActivePromotionsByProductIds(
      dataSource as any,
      ['inv-1'],
      null,
      at,
    );
    const list = map.get('inv-1') ?? [];

    expect(list).toHaveLength(1);
    expect(list[0].mechanic_id).toBe('active');
  });

  it('sets page_slug null when the mechanic has no live page', async () => {
    const skuItems = [
      {
        id: 'item-1',
        product_inventory_id: 'inv-2',
        badge_text: null,
        value: { type: 'fixed', amount: 50 },
        quantity_rules: [],
        promotionMechanic: {
          audience: 'all',
          id: 'mech-no-page',
          name: 'No Page Promo',
          is_active: true,
          start_date: new Date('2026-08-01'),
          end_date: new Date('2026-08-31'),
          badge_text: null,
        },
      },
    ];

    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult(skuItems),
      PromotionPage: qbResult([]),
    });

    const map = await loadActivePromotionsByProductIds(
      dataSource as any,
      ['inv-2'],
      null,
      at,
    );
    const list = map.get('inv-2') ?? [];

    expect(list).toHaveLength(1);
    expect(list[0].page_slug).toBeNull();
  });

  it('takes the first (newest) live page per mechanic', async () => {
    const skuItems = [
      {
        id: 'item-1',
        product_inventory_id: 'inv-3',
        badge_text: null,
        value: { type: 'percentage', percent: 15 },
        quantity_rules: [],
        promotionMechanic: {
          audience: 'all',
          id: 'mech-1',
          name: 'Promo With Pages',
          is_active: true,
          start_date: new Date('2026-08-01'),
          end_date: new Date('2026-08-31'),
          badge_text: null,
        },
      },
    ];
    const pages = [
      {
        slug: 'newer-slug',
        promotion_mechanic_id: 'mech-1',
        campaign_id: null,
      },
      {
        slug: 'older-slug',
        promotion_mechanic_id: 'mech-1',
        campaign_id: null,
      },
    ];

    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult(skuItems),
      PromotionPage: qbResult(pages),
    });

    const map = await loadActivePromotionsByProductIds(
      dataSource as any,
      ['inv-3'],
      null,
      at,
    );
    const list = map.get('inv-3') ?? [];

    expect(list[0].page_slug).toBe('newer-slug');
  });

  it('links a mechanic to the live page of its campaign (no legacy mechanic id needed)', async () => {
    const skuItems = [
      {
        id: 'item-1',
        product_inventory_id: 'inv-4',
        badge_text: null,
        value: { type: 'percentage', percent: 10 },
        quantity_rules: [],
        promotionMechanic: {
          audience: 'all',
          id: 'mech-c',
          campaign_id: 'camp-1',
          name: 'In a campaign',
          is_active: true,
          start_date: new Date('2026-08-01'),
          end_date: new Date('2026-08-31'),
          badge_text: null,
        },
      },
    ];
    const pageRepo = qbResult([
      { slug: 'other', promotion_mechanic_id: null, campaign_id: 'camp-2' },
      { slug: 'campaign-page', promotion_mechanic_id: null, campaign_id: 'camp-1' },
    ]);
    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult(skuItems),
      PromotionPage: pageRepo,
    });

    const map = await loadActivePromotionsByProductIds(dataSource as any, ['inv-4'], null, at);

    expect(map.get('inv-4')?.[0].page_slug).toBe('campaign-page');
    // the live rule (active + window at `at`) and both link paths go to SQL
    const qb = pageRepo.createQueryBuilder.mock.results[0].value;
    expect(qb.where).toHaveBeenCalledWith('page.is_active = true');
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(page.start_date IS NULL OR page.start_date <= :at)',
      { at },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('page.campaign_id IN (:...campaignIds)'),
      { campaignIds: ['camp-1'], mechanicIds: ['mech-c'] },
    );
  });

  it('returns empty Map for empty product ids', async () => {
    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult([]),
      PromotionPage: qbResult([]),
    });

    const map = await loadActivePromotionsByProductIds(dataSource as any, [], null, at);

    expect(map.size).toBe(0);
  });
});

describe('formatPromotionBadgeText', () => {
  it('prefers sku item badge', () => {
    expect(
      formatPromotionBadgeText(
        { type: 'percentage', percent: 10 },
        { badge_text: 'Hot' },
        { badge_text: 'Mech' },
      ),
    ).toBe('Hot');
  });

  it('en: badge_text_en (item, then mechanic), else generated — never the Thai typed badge', () => {
    const pct = { type: 'percentage' as const, percent: 15 };
    expect(
      formatPromotionBadgeText(pct, { badge_text_en: ' Flash ' }, { badge_text_en: 'M' }, 'en'),
    ).toBe('Flash');
    expect(formatPromotionBadgeText(pct, null, { badge_text_en: 'M' }, 'en')).toBe('M');
    expect(formatPromotionBadgeText(pct, { badge_text: 'ลด 15%' }, null, 'en')).toBe('15% off');
    expect(formatPromotionBadgeText(pct, { badge_text: 'ลด 15%', badge_text_en: '  ' }, null, 'en')).toBe('15% off');
  });

  it('th: badge_text wins, an English-only badge falls to generated Thai', () => {
    const pct = { type: 'percentage' as const, percent: 15 };
    expect(formatPromotionBadgeText(pct, { badge_text: 'ขายดี', badge_text_en: 'Hot' }, null, 'th')).toBe('ขายดี');
    expect(formatPromotionBadgeText(pct, { badge_text_en: 'Hot' }, null, 'th')).toBe('ลด 15%');
  });

  it('no value and no typed badge = null', () => {
    expect(formatPromotionBadgeText(null, null, null, 'en')).toBeNull();
  });

  it('formats bogo 100% as ซื้อ X แถม Y', () => {
    expect(
      formatPromotionBadgeText({
        type: 'bogo',
        buy_qty: 1,
        get_qty: 1,
        get_discount_percent: 100,
      }),
    ).toBe('ซื้อ 1 แถม 1');
  });

  it('formats percentage', () => {
    expect(
      formatPromotionBadgeText({ type: 'percentage', percent: 15 }),
    ).toBe('ลด 15%');
  });

  it('generated badge follows lang; admin-typed badge is the one of that language', () => {
    const bogo = {
      type: 'bogo' as const,
      buy_qty: 2,
      get_qty: 1,
      get_discount_percent: 50,
    };
    expect(formatPromotionBadgeText(bogo, null, null, 'en')).toBe(
      'Buy 2 get 1 50% off',
    );
    expect(
      formatPromotionBadgeText({ type: 'percentage', percent: 15 }, null, null, 'en'),
    ).toBe('15% off');
    expect(
      formatPromotionBadgeText({ type: 'fixed', amount: 50 }, null, null, 'en'),
    ).toBe('฿50 off');
    expect(
      formatPromotionBadgeText(
        { type: 'tiered', tiers: [{ min_qty: 1, promotion_price: 1 }, { min_qty: 5, promotion_price: 1 }] },
        null,
        null,
        'en',
      ),
    ).toBe('Volume discount');
    expect(
      formatPromotionBadgeText({ type: 'percentage', percent: 15 }, { badge_text_en: 'Hot' }, null, 'en'),
    ).toBe('Hot');
  });
});

describe('promotionValueFromSkuItem', () => {
  it('returns item.value when present', () => {
    const value = { type: 'percentage' as const, percent: 10 };
    expect(promotionValueFromSkuItem({ value, quantity_rules: [] })).toEqual(value);
  });

  it('maps legacy quantity_rules to tiered', () => {
    expect(
      promotionValueFromSkuItem({
        value: null,
        quantity_rules: [{ min_qty: 1, promotion_price: 100 }],
      }),
    ).toEqual({
      type: 'tiered',
      tiers: [{ min_qty: 1, promotion_price: 100 }],
    });
  });

  it('returns null when no value and empty rules', () => {
    expect(promotionValueFromSkuItem({ value: null, quantity_rules: [] })).toBeNull();
  });
});

describe('loadMechanicPricingByProductIds', () => {
  const at = new Date('2026-08-15');
  const skuItem = (mechanicId: string, start: string, end: string) => ({
    id: `item-${mechanicId}`,
    product_inventory_id: 'inv-1',
    value: { type: 'percentage', percent: 10 },
    quantity_rules: [],
    promotionMechanic: {
      audience: 'all',
      id: mechanicId,
      is_active: true,
      start_date: new Date(start),
      end_date: new Date(end),
    },
  });

  it('returns the value together with the winning mechanic id', async () => {
    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult([
        skuItem('newer', '2026-08-01', '2026-08-31'),
        skuItem('older', '2026-07-01', '2026-08-31'),
      ]),
    });

    const map = await loadMechanicPricingByProductIds(dataSource as any, ['inv-1'], null, at);

    expect(map.get('inv-1')).toEqual({
      value: { type: 'percentage', percent: 10 },
      mechanicId: 'newer',
    });
  });

  it('keeps an entry with no value and no id once every mechanic has expired', async () => {
    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult([skuItem('gone', '2026-06-01', '2026-07-31')]),
    });

    const map = await loadMechanicPricingByProductIds(dataSource as any, ['inv-1'], null, at);

    // presence matters: callers must not fall back to undated quantity rules
    expect(map.has('inv-1')).toBe(true);
    expect(map.get('inv-1')).toEqual({ value: null, mechanicId: null });
  });
});

describe('flash-sale cap: a sold-out mechanic prices nothing', () => {
  const at = new Date('2026-08-15');
  const skuItem = (
    mechanicId: string,
    cap: { max_units?: number | null; sold_units?: number },
    start = '2026-08-01',
  ) => ({
    id: `item-${mechanicId}`,
    product_inventory_id: 'inv-1',
    badge_text: null,
    value: { type: 'percentage', percent: 10 },
    quantity_rules: [],
    promotionMechanic: {
      audience: 'all',
      id: mechanicId,
      name: mechanicId,
      is_active: true,
      start_date: new Date(start),
      end_date: new Date('2026-08-31'),
      badge_text: null,
      campaign_id: null,
      ...cap,
    },
  });

  it('isMechanicSoldOut: only a capped mechanic whose units are all held', () => {
    expect(isMechanicSoldOut({ max_units: null, sold_units: 999 })).toBe(false);
    expect(isMechanicSoldOut({})).toBe(false);
    expect(isMechanicSoldOut({ max_units: 5, sold_units: 4 })).toBe(false);
    expect(isMechanicSoldOut({ max_units: 5, sold_units: 5 })).toBe(true);
    expect(isMechanicSoldOut({ max_units: 5, sold_units: 6 })).toBe(true);
  });

  it('loadMechanicPricingByProductIds: sold out -> entry stays (no fallback to undated rules) but has no value', async () => {
    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult([skuItem('flash', { max_units: 5, sold_units: 5 })]),
    });

    const map = await loadMechanicPricingByProductIds(dataSource as any, ['inv-1'], null, at);

    expect(map.has('inv-1')).toBe(true);
    expect(map.get('inv-1')).toEqual({ value: null, mechanicId: null });
  });

  it('loadMechanicPricingByProductIds: capped with units left, and uncapped, still price', async () => {
    for (const cap of [{ max_units: 5, sold_units: 4 }, { max_units: null, sold_units: 0 }, {}]) {
      const dataSource = makeRepoMap({
        PromotionMechanicSkuItem: qbResult([skuItem('flash', cap)]),
      });
      const map = await loadMechanicPricingByProductIds(dataSource as any, ['inv-1'], null, at);
      expect(map.get('inv-1')?.mechanicId).toBe('flash');
    }
  });

  it('loadMechanicPricingByProductIds: a sold-out newer mechanic yields to the next active one', async () => {
    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult([
        skuItem('flash', { max_units: 1, sold_units: 1 }, '2026-08-10'),
        skuItem('regular', {}, '2026-08-01'),
      ]),
    });

    const map = await loadMechanicPricingByProductIds(dataSource as any, ['inv-1'], null, at);

    expect(map.get('inv-1')?.mechanicId).toBe('regular');
  });

  it('loadActivePromotionsByProductIds (PDP / list badges) drops the sold-out mechanic', async () => {
    const dataSource = makeRepoMap({
      PromotionMechanicSkuItem: qbResult([
        skuItem('flash', { max_units: 5, sold_units: 5 }, '2026-08-10'),
        skuItem('regular', {}, '2026-08-01'),
      ]),
      PromotionPage: qbResult([]),
    });

    const map = await loadActivePromotionsByProductIds(dataSource as any, ['inv-1'], null, at);

    expect(map.get('inv-1')?.map((promotion) => promotion.mechanic_id)).toEqual(['regular']);
  });
});

describe('loadMechanicOwnersByProductIds', () => {
  const at = new Date('2026-08-15');
  const row = (
    id: string,
    mechanic: { id: string; name: string; is_active: boolean; start: string; end: string },
    sku = 'inv-1',
  ) => ({
    id,
    product_inventory_id: sku,
    promotionMechanic: {
      audience: 'all',
      id: mechanic.id,
      name: mechanic.name,
      is_active: mechanic.is_active,
      start_date: new Date(mechanic.start),
      end_date: new Date(mechanic.end),
    },
  });
  const ds = (rows: unknown[]) =>
    makeRepoMap({ PromotionMechanicSkuItem: qbResult(rows) }) as never;

  it('an ended, inactive mechanic still owns its SKU (the resolver never falls back to product rules)', async () => {
    const owners = await loadMechanicOwnersByProductIds(
      ds([row('i1', { id: 'm-old', name: 'Old', is_active: false, start: '2025-01-01', end: '2025-02-01' })]),
      ['inv-1'],
      at,
    );
    expect(owners.get('inv-1')).toEqual({ mechanic_id: 'm-old', mechanic_name: 'Old' });
  });

  it('a SKU with no mechanic row is not in the map', async () => {
    expect((await loadMechanicOwnersByProductIds(ds([]), ['inv-1'], at)).size).toBe(0);
    expect((await loadMechanicOwnersByProductIds(ds([]), [], at)).size).toBe(0);
  });

  it('the mechanic running now wins over a newer one that has not started; else the newest', async () => {
    const owners = await loadMechanicOwnersByProductIds(
      ds([
        // rows arrive newest start_date first
        row('i1', { id: 'm-future', name: 'Future', is_active: true, start: '2026-12-01', end: '2026-12-31' }),
        row('i2', { id: 'm-now', name: 'Now', is_active: true, start: '2026-08-01', end: '2026-08-31' }),
        row('i3', { id: 'm-past', name: 'Past', is_active: true, start: '2026-01-01', end: '2026-01-31' }),
      ]),
      ['inv-1'],
      at,
    );
    expect(owners.get('inv-1')?.mechanic_id).toBe('m-now');

    const none = await loadMechanicOwnersByProductIds(
      ds([
        row('i1', { id: 'm-future', name: 'Future', is_active: true, start: '2026-12-01', end: '2026-12-31' }),
        row('i3', { id: 'm-past', name: 'Past', is_active: true, start: '2026-01-01', end: '2026-01-31' }),
      ]),
      ['inv-1'],
      at,
    );
    expect(none.get('inv-1')?.mechanic_id).toBe('m-future');
  });
});

// ---------------------------------------------------------------------------
// Company-level targeting (audience). One rule, `mechanicAudienceAllows`, used by both loaders.
// ---------------------------------------------------------------------------
describe('company targeting (mechanic audience)', () => {
  const at = new Date('2026-08-15');
  const ACME = '11111111-1111-4111-8111-111111111111';
  const GLOBEX = '22222222-2222-4222-8222-222222222222';

  describe('mechanicAudienceAllows', () => {
    it.each([
      ['everyone: a guest', { audience: 'all' }, null, true],
      ['everyone: any company', { audience: 'all' }, GLOBEX, true],
      ['an audience that was not loaded is NOT everyone (fails closed)', {}, null, false],
      ['an audience that was not loaded does not pass for a company either', { audience_company_ids: [ACME] }, ACME, false],
      ['targeted: a listed company', { audience: 'companies', audience_company_ids: [ACME] }, ACME, true],
      ['targeted: the list is stored lowercase, the caller may not be', { audience: 'companies', audience_company_ids: [ACME] }, ACME.toUpperCase(), true],
      ['targeted: another company', { audience: 'companies', audience_company_ids: [ACME] }, GLOBEX, false],
      ['targeted: a guest', { audience: 'companies', audience_company_ids: [ACME] }, null, false],
      ['targeted: no company given (call site forgot it)', { audience: 'companies', audience_company_ids: [ACME] }, undefined, false],
      ['targeted: list not loaded (select:false) matches nobody', { audience: 'companies' }, ACME, false],
      ['targeted: an empty list matches nobody', { audience: 'companies', audience_company_ids: [] }, ACME, false],
      ['an audience value this code does not know never passes, even for a company on its list', { audience: 'segments', audience_company_ids: [ACME] }, ACME, false],
      ['an audience value this code does not know never passes for a guest either', { audience: 'segments', audience_company_ids: [ACME] }, null, false],
      ['an audience value this code does not know never passes for another company', { audience: 'segments', audience_company_ids: [ACME] }, GLOBEX, false],
    ])('%s', (_label, mechanic, companyId, expected) => {
      expect(mechanicAudienceAllows(mechanic, companyId)).toBe(expected);
    });
  });

  const item = (
    mechanicId: string,
    start: string,
    percent: number,
    audience: Record<string, unknown> = {},
  ) => ({
    id: `item-${mechanicId}`,
    product_inventory_id: 'inv-1',
    badge_text: null,
    value: { type: 'percentage', percent },
    quantity_rules: [],
    promotionMechanic: {
      id: mechanicId,
      name: mechanicId,
      is_active: true,
      start_date: new Date(start),
      end_date: new Date('2026-08-31'),
      badge_text: null,
      audience: 'all',
      ...audience,
    },
  });
  const targeted = { audience: 'companies', audience_company_ids: [ACME] };
  // newest first, like the loaders' ORDER BY start_date DESC
  const rows = () => [
    item('acme-only', '2026-08-10', 30, targeted),
    item('everyone', '2026-08-01', 10),
  ];
  const sources = (mechanics = rows()) => {
    const itemRepo = qbResult(mechanics);
    return {
      ds: makeRepoMap({ PromotionMechanicSkuItem: itemRepo, PromotionPage: qbResult([]) }) as any,
      /** the query builder the loader built — to assert what it selected */
      builder: () => itemRepo.createQueryBuilder.mock.results[0].value,
    };
  };

  describe('loadMechanicPricingByProductIds', () => {
    it('the targeted company gets the targeted mechanic (it is the newest)', async () => {
      const map = await loadMechanicPricingByProductIds(sources().ds, ['inv-1'], ACME, at);
      expect(map.get('inv-1')).toEqual({
        value: { type: 'percentage', percent: 30 },
        mechanicId: 'acme-only',
      });
    });

    it.each([
      ['another company', GLOBEX],
      ['a guest', null],
    ])('%s skips it and gets the next mechanic that applies to them', async (_who, companyId) => {
      const map = await loadMechanicPricingByProductIds(sources().ds, ['inv-1'], companyId, at);
      expect(map.get('inv-1')).toEqual({
        value: { type: 'percentage', percent: 10 },
        mechanicId: 'everyone',
      });
    });

    it('a SKU only a targeted mechanic prices stays mechanic-owned for everyone else (no fallback to undated rules)', async () => {
      const only = sources([item('acme-only', '2026-08-10', 30, targeted)]).ds;
      const other = await loadMechanicPricingByProductIds(only, ['inv-1'], GLOBEX, at);
      const guest = await loadMechanicPricingByProductIds(only, ['inv-1'], null, at);

      for (const map of [other, guest]) {
        expect(map.has('inv-1')).toBe(true);
        expect(map.get('inv-1')).toEqual({ value: null, mechanicId: null });
      }
    });

    it('selects the company list explicitly — it is a select:false column, so without this a targeted company would silently never match', async () => {
      const source = sources();
      await loadMechanicPricingByProductIds(source.ds, ['inv-1'], ACME, at);
      expect(source.builder().addSelect).toHaveBeenCalledWith('mechanic.audience_company_ids');
    });
  });

  describe('loadActivePromotionsByProductIds (badges)', () => {
    it('the targeted company sees both promotions; anyone else only the one for everyone', async () => {
      const ids = async (companyId: string | null) =>
        [
          ...(
            (await loadActivePromotionsByProductIds(sources().ds, ['inv-1'], companyId, at)).get('inv-1') ?? []
          ).map((promotion) => promotion.mechanic_id),
        ];

      expect(await ids(ACME)).toEqual(['acme-only', 'everyone']);
      expect(await ids(GLOBEX)).toEqual(['everyone']);
      expect(await ids(null)).toEqual(['everyone']);
    });

    it('selects the company list explicitly (select:false column)', async () => {
      const source = sources();
      await loadActivePromotionsByProductIds(source.ds, ['inv-1'], ACME, at);
      expect(source.builder().addSelect).toHaveBeenCalledWith('mechanic.audience_company_ids');
    });
  });

  describe('loadHiddenTargetedMechanicIds (public reads / promotion page)', () => {
    const targetedRows = [
      { id: 'acme-only', audience: 'companies', audience_company_ids: [ACME] },
      { id: 'globex-only', audience: 'companies', audience_company_ids: [GLOBEX] },
    ];
    const repo = () => ({ find: jest.fn().mockResolvedValue(targetedRows) });

    it('hides the targeted mechanics the company is not on, from a guest everything targeted', async () => {
      expect([...(await loadHiddenTargetedMechanicIds(repo() as any, ACME))]).toEqual(['globex-only']);
      expect([...(await loadHiddenTargetedMechanicIds(repo() as any, null))].sort()).toEqual([
        'acme-only',
        'globex-only',
      ]);
    });

    it('only asks for targeted rows, narrowed by the caller\'s where, and loads the list column explicitly', async () => {
      const r = repo();
      await loadHiddenTargetedMechanicIds(r as any, ACME, { campaign_id: 'camp-1' });
      const arg = r.find.mock.calls[0][0];
      expect(arg.where).toMatchObject({ campaign_id: 'camp-1' });
      expect(arg.where.audience).toBeDefined(); // Not('all')
      expect(arg.select).toEqual(expect.arrayContaining(['audience_company_ids']));
    });
  });
});
