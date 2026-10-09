import { resolveSkuPrice, resolveSkuPricesBatch } from './pricing.resolver';
import { resolvePromotionValue } from './promotion-value';

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
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockResolvedValue(rows[0] ?? null),
  };
}

function emptyMechanicSkuItems() {
  return qbResult([]);
}

function mechanicSkuItemRow(opts: {
  productInventoryId?: string;
  value: unknown;
  startDate: Date;
  endDate: Date;
  isActive?: boolean;
  id?: string;
  mechanicId?: string;
  /** `companies` = targeted at `audienceCompanyIds` only; default everyone. */
  audience?: string;
  audienceCompanyIds?: string[];
}) {
  return {
    id: opts.id ?? 'sku-item-1',
    product_inventory_id: opts.productInventoryId ?? 'inv-1',
    value: opts.value,
    promotionMechanic: {
      id: opts.mechanicId ?? 'mech-1',
      is_active: opts.isActive ?? true,
      start_date: opts.startDate,
      end_date: opts.endDate,
      audience: opts.audience ?? 'all',
      audience_company_ids: opts.audienceCompanyIds ?? [],
    },
  };
}

describe('pricing.resolver company private_price', () => {
  const inventory = {
    product_inventory_id: 'inv-1',
    selling_price: 1000,
  };

  it('resolveSkuPrice prefers customer_sku (private_price) over contract', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      Branch: {
        findOne: jest.fn().mockResolvedValue({
          id: 'br-1',
          company_id: 'co-1',
        }),
      },
      PrivatePrice: qbResult([
        {
          id: 'pp-1',
          company_id: 'co-1',
          product_inventory_id: 'inv-1',
          private_selling_price: 800,
          start_date: new Date('2026-01-01'),
          end_date: null,
        },
      ]),
      BranchContractPrice: qbResult([
        {
          id: 'cp-1',
          branch_id: 'br-1',
          product_inventory_id: 'inv-1',
          contract_price: 900,
          start_date: new Date('2026-01-01'),
          end_date: null,
        },
      ]),
      ProductBranchSpecial: qbResult([]),
      PromotionMechanicSkuItem: emptyMechanicSkuItems(),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      branchId: 'br-1',
      companyId: 'co-1',
    });

    expect(resolved).toMatchObject({
      price: 800,
      source: 'customer_sku',
      private_price_id: 'pp-1',
    });
  });

  // ตะกร้าใบเดียวมีจำนวนไม่เท่ากันรายบรรทัด ถ้า batch ใช้จำนวนเดียวทั้งก้อน
  // ราคาขั้นบันไดจะผิดเงียบๆ — collectPriceIssues พึ่งพาเส้นนี้ตอน checkout
  it('resolveSkuPricesBatch uses per-SKU quantity for quantity rules', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        find: jest.fn().mockResolvedValue([
          { product_inventory_id: 'inv-1', selling_price: 100 },
          { product_inventory_id: 'inv-2', selling_price: 100 },
        ]),
      },
      PromotionMechanicSkuItem: emptyMechanicSkuItems(),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([
          {
            product_inventory_id: 'inv-1',
            min_qty: 5,
            max_qty: null,
            promotion_price: 80,
            is_active: true,
            sort_order: 0,
          },
          {
            product_inventory_id: 'inv-2',
            min_qty: 5,
            max_qty: null,
            promotion_price: 80,
            is_active: true,
            sort_order: 0,
          },
        ]),
      },
    });

    const map = await resolveSkuPricesBatch(dataSource as any, {
      productInventoryIds: ['inv-1', 'inv-2'],
      quantityById: new Map([
        ['inv-1', 6], // ถึงขั้น 5+ → ได้ราคาโปรฯ
        ['inv-2', 2], // ยังไม่ถึง → ราคาปกติ
      ]),
    });

    expect(map.get('inv-1')?.price).toBe(80);
    expect(map.get('inv-2')?.price).toBe(100);
  });

  it('a ฿0 quantity rule or a % off a SKU with no selling_price never prices the SKU at 0', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        find: jest.fn().mockResolvedValue([
          { product_inventory_id: 'inv-1', selling_price: 4775 },
          { product_inventory_id: 'inv-2', selling_price: null },
        ]),
      },
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          productInventoryId: 'inv-2',
          value: { type: 'percentage', percent: 20 },
          startDate: new Date('2020-01-01'),
          endDate: new Date('2099-01-01'),
        }),
      ]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([
          { product_inventory_id: 'inv-1', min_qty: 1, max_qty: null, promotion_price: 0, is_active: true, sort_order: 0 },
        ]),
      },
    });

    const map = await resolveSkuPricesBatch(dataSource as any, { productInventoryIds: ['inv-1', 'inv-2'] });

    expect(map.get('inv-1')).toMatchObject({ price: 4775, source: 'base' });
    expect(map.get('inv-2')).toMatchObject({ price: 0, source: 'base' });
  });

  it('resolveSkuPricesBatch falls back to the shared quantity when quantityById has no entry', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        find: jest
          .fn()
          .mockResolvedValue([
            { product_inventory_id: 'inv-1', selling_price: 100 },
          ]),
      },
      PromotionMechanicSkuItem: emptyMechanicSkuItems(),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([
          {
            product_inventory_id: 'inv-1',
            min_qty: 5,
            max_qty: null,
            promotion_price: 80,
            is_active: true,
            sort_order: 0,
          },
        ]),
      },
    });

    const map = await resolveSkuPricesBatch(dataSource as any, {
      productInventoryIds: ['inv-1'],
      quantity: 6,
      quantityById: new Map([['other-inv', 1]]),
    });

    expect(map.get('inv-1')?.price).toBe(80);
  });

  it('resolveSkuPricesBatch applies customer_sku before contract', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        find: jest.fn().mockResolvedValue([inventory]),
      },
      Branch: {
        findOne: jest.fn().mockResolvedValue({
          id: 'br-1',
          company_id: 'co-1',
        }),
      },
      PrivatePrice: {
        find: jest.fn().mockResolvedValue([
          {
            id: 'pp-1',
            company_id: 'co-1',
            product_inventory_id: 'inv-1',
            private_selling_price: 750,
            start_date: new Date('2026-01-01'),
            end_date: null,
          },
        ]),
      },
      BranchContractPrice: {
        find: jest.fn().mockResolvedValue([
          {
            id: 'cp-1',
            branch_id: 'br-1',
            product_inventory_id: 'inv-1',
            contract_price: 880,
            start_date: new Date('2026-01-01'),
            end_date: null,
          },
        ]),
      },
      ProductBranchSpecial: {
        find: jest.fn().mockResolvedValue([]),
      },
      PromotionMechanicSkuItem: emptyMechanicSkuItems(),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const map = await resolveSkuPricesBatch(dataSource as any, {
      productInventoryIds: ['inv-1'],
      branchId: 'br-1',
      companyId: 'co-1',
    });

    expect(map.get('inv-1')).toMatchObject({
      price: 750,
      source: 'customer_sku',
      private_price_id: 'pp-1',
    });
  });

  /**
   * The resolver used to derive a company from `branchId` when no company was passed,
   * so anyone able to send another company's branch id (a guest on the product list, a
   * logged-in user on the cart) was handed that company's customer-SKU prices.
   * There is deliberately no Branch / PrivatePrice repo below: reading either throws.
   */
  describe('never derives a company from a branch id', () => {
    const contractRow = {
      id: 'cp-1',
      branch_id: 'br-victim',
      product_inventory_id: 'inv-1',
      contract_price: 900,
      start_date: new Date('2026-01-01'),
      end_date: null,
    };

    it.each([
      ['absent', {}],
      ['null', { companyId: null }],
    ])('resolveSkuPrice with a branch and companyId %s does not read private prices', async (_label, extra) => {
      const dataSource = makeRepoMap({
        ProductInventory: { findOne: jest.fn().mockResolvedValue(inventory) },
        BranchContractPrice: qbResult([contractRow]),
        ProductBranchSpecial: qbResult([]),
        PromotionMechanicSkuItem: emptyMechanicSkuItems(),
        PromotionQuantityRule: { find: jest.fn().mockResolvedValue([]) },
      });

      const resolved = await resolveSkuPrice(dataSource as any, {
        productInventoryId: 'inv-1',
        branchId: 'br-victim',
        ...extra,
      });

      expect(resolved.source).not.toBe('customer_sku');
      expect(resolved.source).toBe('contract_sku');
    });

    it.each([
      ['absent', {}],
      ['null', { companyId: null }],
    ])('resolveSkuPricesBatch with a branch and companyId %s does not read private prices', async (_label, extra) => {
      const dataSource = makeRepoMap({
        ProductInventory: { find: jest.fn().mockResolvedValue([inventory]) },
        BranchContractPrice: { find: jest.fn().mockResolvedValue([contractRow]) },
        ProductBranchSpecial: { find: jest.fn().mockResolvedValue([]) },
        PromotionMechanicSkuItem: emptyMechanicSkuItems(),
        PromotionQuantityRule: { find: jest.fn().mockResolvedValue([]) },
      });

      const map = await resolveSkuPricesBatch(dataSource as any, {
        productInventoryIds: ['inv-1'],
        branchId: 'br-victim',
        ...extra,
      });

      expect(map.get('inv-1')?.source).toBe('contract_sku');
    });

    it('a guest with neither company nor branch gets the catalog price', async () => {
      const dataSource = makeRepoMap({
        ProductInventory: { findOne: jest.fn().mockResolvedValue(inventory) },
        PromotionMechanicSkuItem: emptyMechanicSkuItems(),
        PromotionQuantityRule: { find: jest.fn().mockResolvedValue([]) },
      });

      await expect(
        resolveSkuPrice(dataSource as any, {
          productInventoryId: 'inv-1',
          companyId: null,
        }),
      ).resolves.toMatchObject({ price: 1000, source: 'base' });
    });
  });

  it('resolveSkuPrice with companyId alone applies customer_sku (no branchId)', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      PrivatePrice: qbResult([
        {
          id: 'pp-1',
          company_id: 'co-1',
          product_inventory_id: 'inv-1',
          private_selling_price: 770,
          start_date: new Date('2026-01-01'),
          end_date: null,
        },
      ]),
      PromotionMechanicSkuItem: emptyMechanicSkuItems(),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      companyId: 'co-1',
    });

    expect(resolved).toMatchObject({
      price: 770,
      source: 'customer_sku',
      private_price_id: 'pp-1',
    });
  });

  it('falls through to contract when no private_price', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      Branch: {
        findOne: jest.fn().mockResolvedValue({
          id: 'br-1',
          company_id: 'co-1',
        }),
      },
      PrivatePrice: qbResult([]),
      BranchContractPrice: qbResult([
        {
          id: 'cp-1',
          branch_id: 'br-1',
          product_inventory_id: 'inv-1',
          contract_price: 900,
          start_date: new Date('2026-01-01'),
          end_date: null,
        },
      ]),
      ProductBranchSpecial: qbResult([]),
      PromotionMechanicSkuItem: emptyMechanicSkuItems(),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      branchId: 'br-1',
    });

    expect(resolved).toMatchObject({
      price: 900,
      source: 'contract_sku',
      contract_price_id: 'cp-1',
    });
  });
});

describe('pricing.resolver active mechanic SKU PromotionValue', () => {
  const at = new Date('2026-06-15T12:00:00.000Z');
  const inventory = {
    product_inventory_id: 'inv-1',
    selling_price: 100,
  };

  it('resolves percentage 10% on base 100 to unit price 90', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          value: { type: 'percentage', percent: 10 },
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        }),
      ]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      quantity: 1,
      at,
    });

    expect(resolved).toMatchObject({
      price: 90,
      source: 'promotion_mechanic',
    });
  });

  it('resolves bogo buy2 get1 at qty 3 to helper unit price', async () => {
    const value = {
      type: 'bogo' as const,
      buy_qty: 2,
      get_qty: 1,
      get_discount_percent: 100,
    };
    const quantity = 3;
    const basePrice = 100;
    const { discountAmount } = resolvePromotionValue(value, {
      basePrice,
      quantity,
    });
    const expectedUnit =
      (basePrice * quantity - (discountAmount ?? 0)) / quantity;

    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          value,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        }),
      ]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      quantity,
      at,
    });

    expect(resolved).toMatchObject({
      price: expectedUnit,
      source: 'promotion_mechanic',
    });
    // buy2 get1 free @ qty3 → one free unit → (300-100)/3
    expect(resolved.price).toBeCloseTo(200 / 3, 5);
  });

  it('does not let an expired mechanic win', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          value: { type: 'percentage', percent: 10 },
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        }),
      ]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      quantity: 1,
      at,
    });

    expect(resolved).toMatchObject({
      price: 100,
      source: 'base',
    });
  });

  it('expired rules-only mechanic ignores its stale undated product-rule mirror', async () => {
    const quantityRulesFind = jest.fn().mockResolvedValue([
      {
        product_inventory_id: 'inv-1',
        min_qty: 1,
        promotion_price: 0,
        is_active: true,
      },
    ]);
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      PromotionMechanicSkuItem: qbResult([
        {
          ...mechanicSkuItemRow({
            value: null,
            startDate: new Date('2025-01-01'),
            endDate: new Date('2025-12-31'),
          }),
          quantity_rules: [{ min_qty: 1, promotion_price: 0 }],
        },
      ]),
      PromotionQuantityRule: {
        find: quantityRulesFind,
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      quantity: 1,
      at,
    });

    expect(resolved).toMatchObject({
      price: 100,
      source: 'base',
    });
    expect(quantityRulesFind).not.toHaveBeenCalled();
  });

  it('inactive mechanic (no active value rows) falls to base without leftover rules', async () => {
    // SQL filters is_active=false — mock returns no sku-item value rows.
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      PromotionMechanicSkuItem: qbResult([]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      quantity: 1,
      at,
    });

    expect(resolved).toMatchObject({
      price: 100,
      source: 'base',
    });
  });

  it('newest start_date wins when two active mechanics cover the same SKU', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      // Rows already ordered by start_date DESC (as the SQL query does).
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          id: 'sku-item-newer',
          value: { type: 'percentage', percent: 20 },
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-12-31'),
        }),
        mechanicSkuItemRow({
          id: 'sku-item-older',
          value: { type: 'percentage', percent: 10 },
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        }),
      ]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      quantity: 1,
      at,
    });

    expect(resolved).toMatchObject({
      price: 80,
      source: 'promotion_mechanic',
    });
  });

  it('prefers active sku-item value over legacy quantity_rules', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
      },
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          value: { type: 'percentage', percent: 10 },
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        }),
      ]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([
          {
            min_qty: 1,
            promotion_price: 70,
            sort_order: 0,
            product_inventory_id: 'inv-1',
            is_active: true,
          },
        ]),
      },
    });

    const resolved = await resolveSkuPrice(dataSource as any, {
      productInventoryId: 'inv-1',
      quantity: 1,
      at,
    });

    expect(resolved).toMatchObject({
      price: 90,
      source: 'promotion_mechanic',
    });
  });

  it('resolveSkuPricesBatch applies active mechanic percentage value', async () => {
    const dataSource = makeRepoMap({
      ProductInventory: {
        find: jest.fn().mockResolvedValue([inventory]),
      },
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          value: { type: 'percentage', percent: 10 },
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        }),
      ]),
      PromotionQuantityRule: {
        find: jest.fn().mockResolvedValue([]),
      },
    });

    const map = await resolveSkuPricesBatch(dataSource as any, {
      productInventoryIds: ['inv-1'],
      quantity: 1,
      at,
    });

    expect(map.get('inv-1')).toMatchObject({
      price: 90,
      source: 'promotion_mechanic',
    });
  });
});

// order_items.promotion_mechanic_id (flash-sale caps / per-campaign reporting)
// reads this — it must name the mechanic that priced the SKU, and be null for
// every other price layer so a cap never counts a customer/contract price.
describe('pricing.resolver promotion_mechanic_id', () => {
  const at = new Date('2026-06-15T12:00:00.000Z');
  const inventory = { product_inventory_id: 'inv-1', selling_price: 100 };
  const noRules = { find: jest.fn().mockResolvedValue([]) };

  it('names the winning mechanic for a mechanic-priced SKU (single + batch)', async () => {
    const ds = () =>
      makeRepoMap({
        ProductInventory: {
          findOne: jest.fn().mockResolvedValue(inventory),
          find: jest.fn().mockResolvedValue([inventory]),
        },
        // newest start_date first, as the SQL orders it
        PromotionMechanicSkuItem: qbResult([
          mechanicSkuItemRow({
            mechanicId: 'mech-newer',
            value: { type: 'percentage', percent: 20 },
            startDate: new Date('2026-06-01'),
            endDate: new Date('2026-12-31'),
          }),
          mechanicSkuItemRow({
            mechanicId: 'mech-older',
            value: { type: 'percentage', percent: 10 },
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
          }),
        ]),
        PromotionQuantityRule: noRules,
      });

    const single = await resolveSkuPrice(ds() as any, {
      productInventoryId: 'inv-1',
      at,
    });
    expect(single).toMatchObject({
      price: 80,
      source: 'promotion_mechanic',
      promotion_mechanic_id: 'mech-newer',
    });

    const batch = await resolveSkuPricesBatch(ds() as any, {
      productInventoryIds: ['inv-1'],
      at,
    });
    expect(batch.get('inv-1')).toMatchObject({
      price: 80,
      source: 'promotion_mechanic',
      promotion_mechanic_id: 'mech-newer',
    });
  });

  it('is null when no mechanic prices the SKU (base, expired mechanic)', async () => {
    const base = makeRepoMap({
      ProductInventory: { findOne: jest.fn().mockResolvedValue(inventory) },
      PromotionMechanicSkuItem: emptyMechanicSkuItems(),
      PromotionQuantityRule: noRules,
    });
    expect(
      await resolveSkuPrice(base as any, { productInventoryId: 'inv-1', at }),
    ).toMatchObject({ source: 'base', promotion_mechanic_id: null });

    const expired = makeRepoMap({
      ProductInventory: { findOne: jest.fn().mockResolvedValue(inventory) },
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          value: { type: 'percentage', percent: 10 },
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
        }),
      ]),
      PromotionQuantityRule: noRules,
    });
    expect(
      await resolveSkuPrice(expired as any, { productInventoryId: 'inv-1', at }),
    ).toMatchObject({ source: 'base', promotion_mechanic_id: null });
  });

  it('is null for a higher layer (customer_sku) even when a mechanic also covers the SKU', async () => {
    const ds = makeRepoMap({
      ProductInventory: { findOne: jest.fn().mockResolvedValue(inventory) },
      PrivatePrice: qbResult([
        {
          id: 'pp-1',
          company_id: 'co-1',
          product_inventory_id: 'inv-1',
          private_selling_price: 70,
          start_date: new Date('2026-01-01'),
          end_date: null,
        },
      ]),
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          value: { type: 'percentage', percent: 10 },
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        }),
      ]),
      PromotionQuantityRule: noRules,
    });
    expect(
      await resolveSkuPrice(ds as any, {
        productInventoryId: 'inv-1',
        companyId: 'co-1',
        at,
      }),
    ).toMatchObject({
      source: 'customer_sku',
      promotion_mechanic_id: null,
    });
  });

  it('is null for the legacy promotion_quantity_rules fallback (source stays promotion_mechanic)', async () => {
    const rule = {
      product_inventory_id: 'inv-1',
      min_qty: 1,
      max_qty: null,
      promotion_price: 80,
      is_active: true,
      sort_order: 0,
    };
    const ds = () =>
      makeRepoMap({
        ProductInventory: {
          findOne: jest.fn().mockResolvedValue(inventory),
          find: jest.fn().mockResolvedValue([inventory]),
        },
        PromotionMechanicSkuItem: emptyMechanicSkuItems(),
        PromotionQuantityRule: { find: jest.fn().mockResolvedValue([rule]) },
      });

    expect(
      await resolveSkuPrice(ds() as any, { productInventoryId: 'inv-1', at }),
    ).toMatchObject({
      price: 80,
      source: 'promotion_mechanic',
      promotion_mechanic_id: null,
    });
    const batch = await resolveSkuPricesBatch(ds() as any, {
      productInventoryIds: ['inv-1'],
      at,
    });
    expect(batch.get('inv-1')).toMatchObject({
      price: 80,
      source: 'promotion_mechanic',
      promotion_mechanic_id: null,
    });
  });
});

// Company-level targeting: the resolver hands the company it prices for (given, or derived from the
// branch) to the mechanic loader, so a targeted promo prices only that company.
describe('pricing.resolver company-targeted mechanic', () => {
  const at = new Date('2026-06-15T12:00:00.000Z');
  const ACME = 'co-acme';
  const GLOBEX = 'co-globex';
  const inventory = { product_inventory_id: 'inv-1', selling_price: 100 };
  const noRules = { find: jest.fn().mockResolvedValue([]) };
  const window = { startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') };

  /** newest first (as the SQL orders it): a 30% promo for ACME only, then a 10% promo for everyone */
  const world = (opts: { withEveryone?: boolean } = {}) =>
    makeRepoMap({
      ProductInventory: {
        findOne: jest.fn().mockResolvedValue(inventory),
        find: jest.fn().mockResolvedValue([inventory]),
      },
      Branch: {
        findOne: jest.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          company_id: where.id === 'br-acme' ? ACME : GLOBEX,
        })),
      },
      PrivatePrice: qbResult([]),
      BranchContractPrice: qbResult([]),
      ProductBranchSpecial: qbResult([]),
      PromotionMechanicSkuItem: qbResult([
        mechanicSkuItemRow({
          mechanicId: 'acme-only',
          value: { type: 'percentage', percent: 30 },
          audience: 'companies',
          audienceCompanyIds: [ACME],
          ...window,
        }),
        ...(opts.withEveryone === false
          ? []
          : [
              mechanicSkuItemRow({
                mechanicId: 'everyone',
                value: { type: 'percentage', percent: 10 },
                startDate: new Date('2026-01-01'),
                endDate: new Date('2026-12-31'),
              }),
            ]),
      ]),
      PromotionQuantityRule: noRules,
    });

  it.each([
    ['the targeted company (companyId)', { companyId: ACME }, 70, 'acme-only'],
    // a company is never derived from a branch id (a client can name any branch)
    ['a branch alone — even the targeted company\'s branch', { branchId: 'br-acme' }, 90, 'everyone'],
    ['another company', { companyId: GLOBEX }, 90, 'everyone'],
    ['another company (derived from its branch)', { branchId: 'br-globex' }, 90, 'everyone'],
    ['a guest', {}, 90, 'everyone'],
  ])('single: %s', async (_who, who, price, mechanicId) => {
    const resolved = await resolveSkuPrice(world() as any, { productInventoryId: 'inv-1', at, ...who });
    expect(resolved).toMatchObject({ price, source: 'promotion_mechanic', promotion_mechanic_id: mechanicId });
  });

  it.each([
    ['the targeted company (companyId)', { companyId: ACME }, 70, 'acme-only'],
    // a company is never derived from a branch id (a client can name any branch)
    ['a branch alone — even the targeted company\'s branch', { branchId: 'br-acme' }, 90, 'everyone'],
    ['another company', { companyId: GLOBEX }, 90, 'everyone'],
    ['a guest', {}, 90, 'everyone'],
  ])('batch: %s', async (_who, who, price, mechanicId) => {
    const map = await resolveSkuPricesBatch(world() as any, { productInventoryIds: ['inv-1'], at, ...who });
    expect(map.get('inv-1')).toMatchObject({ price, source: 'promotion_mechanic', promotion_mechanic_id: mechanicId });
  });

  it.each([
    ['another company', { companyId: GLOBEX }],
    ['a guest', {}],
  ])('a SKU only the targeted mechanic prices is plain base price for %s (no leak, no legacy fallback)', async (_who, who) => {
    const ds = world({ withEveryone: false });

    expect(await resolveSkuPrice(ds as any, { productInventoryId: 'inv-1', at, ...who })).toMatchObject({
      price: 100,
      source: 'base',
      promotion_mechanic_id: null,
    });
    expect(
      (await resolveSkuPricesBatch(ds as any, { productInventoryIds: ['inv-1'], at, ...who })).get('inv-1'),
    ).toMatchObject({ price: 100, source: 'base', promotion_mechanic_id: null });
  });
});
