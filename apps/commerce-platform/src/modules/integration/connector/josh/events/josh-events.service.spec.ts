import { BadRequestException } from '@nestjs/common';
import { JoshEventsService } from './josh-events.service';

function makeService(storedVersion: string | null) {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const repo = { upsert: jest.fn(), delete: jest.fn(), insert: jest.fn(), save: jest.fn() };
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT source_version')) return storedVersion === null ? [] : [{ source_version: storedVersion }];
      return [];
    }),
    getRepository: jest.fn(() => repo),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
  return { svc: new JoshEventsService(dataSource as never), repo, calls };
}

const ORDER = '11111111-1111-1111-1111-111111111111';
const order = (version: string) => ({
  type: 'order.snapshot', aggregateId: ORDER, version, occurredAt: '2026-10-06T00:00:00Z',
  data: { order: { orders_id: ORDER, status: 'paid', total_price: '10.00' }, items: [{ id: 'i1', order_id: ORDER, product_quantity: 2 }] },
});

describe('JoshEventsService', () => {
  it('applies a newer order snapshot: locks the aggregate, upserts head with source_version, replaces lines', async () => {
    const { svc, calls, repo } = makeService('5');
    expect(await svc.apply(order('6'))).toBe('applied');
    expect(calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(repo.upsert).toHaveBeenCalledWith([expect.objectContaining({ ordersId: ORDER, status: 'paid', sourceVersion: '6' })], ['ordersId']);
    expect(repo.delete).toHaveBeenCalledWith({ ordersId: ORDER });
    expect(repo.insert).toHaveBeenCalledWith([expect.objectContaining({ id: 'i1', productQuantity: 2 })]);
  });

  it('drops an equal or older order snapshot', async () => {
    const { svc, repo } = makeService('6');
    expect(await svc.apply(order('6'))).toBe('stale');
    expect(await svc.apply(order('3'))).toBe('stale');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('compares versions as integers, not strings', async () => {
    const { svc } = makeService('9');
    expect(await svc.apply(order('10'))).toBe('applied');
  });

  it('customer.deleted wipes data and keeps a tombstone that blocks older snapshots', async () => {
    const { svc, repo } = makeService(null);
    expect(await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } })).toBe('applied');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', data: {}, sourceVersion: '9', deletedAt: expect.any(Date) }));
  });

  it('customer.deleted also removes the customer\'s metrics and segment memberships (PDPA, stage 2a)', async () => {
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } });
    const sqls = calls.map(([sql]) => sql);
    expect(sqls).toContain('DELETE FROM customer_metrics WHERE user_id = $1');
    expect(sqls).toContain('DELETE FROM segment_members WHERE user_id = $1');
    expect(calls.find(([sql]) => sql.startsWith('DELETE FROM segment_members'))?.[1]).toEqual(['u1']);
  });

  it('customer.deleted unlinks the customer\'s winback account (PDPA, stage 2b)', async () => {
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } });
    const sqls = calls.map(([sql]) => sql);
    expect(sqls).toContain('UPDATE winback_account SET josh_user_id = NULL WHERE josh_user_id = $1');
  });

  it('an older customer.deleted (stale) removes nothing', async () => {
    const { svc, calls } = makeService('10');
    expect(await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } })).toBe('stale');
    expect(calls.map(([sql]) => sql).filter((sql) => sql.startsWith('DELETE'))).toEqual([]);
  });

  it('stores erp.fallback.received once per josh outbox id', async () => {
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'erp.fallback.received', aggregateId: 'e1', version: '77', occurredAt: '2026-10-06T01:00:00Z',
      data: { method: 'PUT', path: '/api/erp/products/qty', body: [{ PRODUCT_CODE: 'A' }], receivedAt: '2026-10-06T01:00:00Z' } });
    const insert = calls.find(([s]) => s.includes('josh_erp_fallback_calls'));
    expect(insert?.[0]).toContain('ON CONFLICT (josh_outbox_id) DO NOTHING');
    expect(insert?.[1]?.[0]).toBe('77');
  });

  it('order.snapshot replaces payments, shipments and refunds per order (stage 5, S5-11)', async () => {
    const { svc, calls, repo } = makeService('5');
    const e = order('6');
    const data = { ...e.data, order: { ...e.data.order, sending_date: '2026-10-08T00:00:00Z' },
      payments: [{ id: 't1', order_id: ORDER, status: 'success', amount: '10.00' }], shipments: [], refunds: [{ id: 'r1', amount: '5.00', status: 'refunded' }] };
    expect(await svc.apply({ ...e, data })).toBe('applied');
    expect(repo.upsert).toHaveBeenCalledWith([expect.objectContaining({ sendingDate: '2026-10-08T00:00:00Z' })], ['ordersId']);
    const sqls = calls.map(([sql]) => sql);
    for (const t of ['josh_order_payments', 'josh_order_shipments', 'josh_order_refunds']) expect(sqls).toContain(`DELETE FROM ${t} WHERE orders_id = $1`);
    const inserts = calls.filter(([sql]) => sql.startsWith('INSERT INTO josh_order_'));
    expect(inserts.map(([sql]) => sql.split(' ')[2])).toEqual(['josh_order_payments', 'josh_order_refunds']); // no rows → no insert
    expect(inserts[0][0]).toContain('jsonb_populate_recordset(NULL::josh_order_payments, $1::jsonb)');
    expect(JSON.parse(inserts[1][1]?.[0] as string)).toEqual([{ id: 'r1', amount: '5.00', status: 'refunded', orders_id: ORDER }]);
  });

  it('an order.snapshot from a josh before stage 5 leaves payments / shipments / refunds / sending_date alone', async () => {
    const { svc, calls, repo } = makeService('5');
    await svc.apply(order('6'));
    expect(calls.map(([sql]) => sql).filter((sql) => /josh_order_(payments|shipments|refunds)/.test(sql))).toEqual([]);
    expect(repo.upsert.mock.calls[0][0][0]).not.toHaveProperty('sendingDate');
  });

  const PRODUCT = '33333333-3333-3333-3333-333333333333';
  const catalog = (version: string, sku = 'S1') => ({
    type: 'catalog.snapshot', aggregateId: PRODUCT, version, occurredAt: 'x',
    data: { id: PRODUCT, sku, status: 'active', selling_unit_price: '120.00', ordering_price: '480.00', order_taking_unit: 'BX',
      category_name_th: 'ผัก', category_name_en: 'Vegetables', image_url: 'https://img/1.jpg',
      translations: [{ language_code: 'th', product_name: 'ผักกาด' }], updated_at: '2026-10-07T01:00:00Z' },
  });

  it('catalog.snapshot upserts the catalog copy with raw values and clears removed_at', async () => {
    const { svc, repo, calls } = makeService('4');
    expect(await svc.apply(catalog('5'))).toBe('applied');
    expect(calls[0][1]).toEqual([`josh_catalog_products:${PRODUCT}`]);
    expect(repo.upsert).toHaveBeenCalledWith([expect.objectContaining({
      id: PRODUCT, sku: 'S1', sellingUnitPrice: '120.00', orderingPrice: '480.00', orderTakingUnit: 'BX',
      categoryNameTh: 'ผัก', categoryNameEn: 'Vegetables', imageUrl: 'https://img/1.jpg', removedAt: null, sourceVersion: '5',
      joshUpdatedAt: new Date('2026-10-07T01:00:00Z'), translations: [{ language_code: 'th', product_name: 'ผักกาด' }],
    })], ['id']);
  });

  it('catalog.snapshot stores the products report fields when josh sends them (stage 5, S5-11)', async () => {
    const { svc, repo } = makeService('4');
    const e = catalog('5');
    await svc.apply({ ...e, data: { ...e.data, category_id: 'c1', category_path: 'อาหาร > ผัก', original_price: '150.00', sup_code: 'SUP1',
      product_inventory_quantity: 0, low_stock_threshold: 10, moq: 2, order_taking_flag: 'N', erp_pending_source: 'price',
      erp_pending_at: '2026-10-07T02:00:00Z', image_count: 3 } });
    expect(repo.upsert).toHaveBeenCalledWith([expect.objectContaining({
      categoryId: 'c1', categoryPath: 'อาหาร > ผัก', originalPrice: '150.00', supCode: 'SUP1', productInventoryQuantity: 0, lowStockThreshold: 10,
      moq: 2, orderTakingFlag: 'N', erpPendingSource: 'price', erpPendingAt: new Date('2026-10-07T02:00:00Z'), imageCount: 3,
    })], ['id']);
  });

  it('an older-shape catalog.snapshot (no report fields) does not null them', async () => {
    const { svc, repo } = makeService('4');
    await svc.apply(catalog('5'));
    expect(repo.upsert.mock.calls[0][0][0]).not.toHaveProperty('categoryPath');
    expect(repo.upsert.mock.calls[0][0][0]).not.toHaveProperty('productInventoryQuantity');
  });

  it('drops an older catalog.snapshot', async () => {
    const { svc, repo } = makeService('9');
    expect(await svc.apply(catalog('8', 'OLD'))).toBe('stale');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('catalog.deleted marks the copy removed (rows are never deleted) and records the version', async () => {
    const { svc, calls } = makeService('5');
    expect(await svc.apply({ type: 'catalog.deleted', aggregateId: PRODUCT, version: '6', occurredAt: 'x', data: { id: PRODUCT } })).toBe('applied');
    const update = calls.find(([s]) => s.includes('UPDATE josh_catalog_products'));
    expect(update?.[0]).toContain('removed_at = now()');
    expect(update?.[1]).toEqual([PRODUCT, '6']);
  });

  it('rejects a catalog.snapshot whose data id does not match', async () => {
    const { svc } = makeService(null);
    await expect(svc.apply({ ...catalog('2'), aggregateId: '44444444-4444-4444-4444-444444444444' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown types and a snapshot whose order id does not match', async () => {
    const { svc } = makeService(null);
    await expect(svc.apply({ type: 'nope', aggregateId: 'x', version: '1', occurredAt: 'x', data: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.apply({ ...order('2'), aggregateId: '22222222-2222-2222-2222-222222222222' })).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('reference copies (stage 2c)', () => {
    const CO = '22222222-2222-4222-8222-222222222222';
    function ref(stored: { row?: string; tomb?: string } = {}) {
      const calls: Array<[string, unknown[] | undefined]> = [];
      const manager = {
        query: jest.fn(async (sql: string, params?: unknown[]) => {
          calls.push([sql, params]);
          if (sql.includes('GREATEST')) {
            const v = [stored.row, stored.tomb].filter(Boolean).map((x) => BigInt(x!)).sort((a, b) => (a > b ? -1 : 1))[0];
            return [{ version: v == null ? null : String(v) }];
          }
          if (sql.includes('information_schema')) return ['id', 'name', 'register_number', 'source_version'].map((column_name) => ({ column_name }));
          return [];
        }),
      };
      const dataSource = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
      return { svc: new JoshEventsService(dataSource as never), calls };
    }
    const company = (version: string) => ({ type: 'company.snapshot', aggregateId: CO, version, occurredAt: 'x', data: { id: CO, name: 'ACME', register_number: '0105', extra: 1 } });

    it('upserts the columns commerce has with the version', async () => {
      const { svc, calls } = ref();
      expect(await svc.apply(company('5'))).toBe('applied');
      const insert = calls.find(([sql]) => sql.startsWith('INSERT INTO josh_companies'));
      expect(insert?.[0]).toContain('("id", "name", "register_number", source_version)');
      expect(insert?.[0]).toContain('jsonb_populate_record(NULL::josh_companies, $1::jsonb)');
      expect(insert?.[1]).toEqual([JSON.stringify(company('5').data), '5']);
    });

    it('a snapshot older than the stored row or the tombstone is stale', async () => {
      expect(await ref({ row: '6' }).svc.apply(company('5'))).toBe('stale');
      expect(await ref({ tomb: '9' }).svc.apply(company('8'))).toBe('stale');
    });

    it('staff.deleted removes the row, leaves a tombstone and unassigns the rep', async () => {
      const { svc, calls } = ref();
      expect(await svc.apply({ type: 'staff.deleted', aggregateId: CO, version: '12', occurredAt: 'x', data: { id: CO } })).toBe('applied');
      const sqls = calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());
      expect(sqls).toContain('DELETE FROM josh_staff WHERE id = $1');
      expect(sqls.some((q) => q.startsWith('INSERT INTO josh_reference_tombstones'))).toBe(true);
      expect(sqls).toContain('UPDATE company_sales_reps SET assigned_sales_user_id = NULL, updated_at = now() WHERE assigned_sales_user_id = $1');
    });

    it('branch.snapshot (stage 5) goes to josh_branches like the other reference rows', async () => {
      const { svc, calls } = ref();
      expect(await svc.apply({ type: 'branch.snapshot', aggregateId: CO, version: '20', occurredAt: 'x', data: { id: CO, name: 'สาขา 1' } })).toBe('applied');
      expect(calls.find(([sql]) => sql.startsWith('INSERT INTO josh_branches'))?.[0]).toContain('jsonb_populate_record(NULL::josh_branches, $1::jsonb)');
    });

    it('jagota_sync.snapshot (stage 5) upserts the ERP send history and stamps imported_at', async () => {
      const { svc, calls } = ref();
      expect(await svc.apply({ type: 'jagota_sync.snapshot', aggregateId: CO, version: '21', occurredAt: 'x', data: { id: CO, sync_status: 'failed' } })).toBe('applied');
      const sqls = calls.map(([sql]) => sql);
      expect(sqls.some((q) => q.startsWith('INSERT INTO jagota_order_sync_history'))).toBe(true);
      expect(sqls).toContain('UPDATE jagota_order_sync_history SET imported_at = now() WHERE id = $1');
      expect(await ref({ row: '30' }).svc.apply({ type: 'jagota_sync.snapshot', aggregateId: CO, version: '21', occurredAt: 'x', data: { id: CO } })).toBe('stale');
    });

    it('push_campaign.snapshot (stage 5, S5-12) goes to josh_push_campaigns like the other reference rows', async () => {
      const { svc, calls } = ref();
      expect(await svc.apply({ type: 'push_campaign.snapshot', aggregateId: CO, version: '40', occurredAt: 'x', data: { id: CO, name: 'Promo' } })).toBe('applied');
      expect(calls.find(([sql]) => sql.startsWith('INSERT INTO josh_push_campaigns'))?.[0]).toContain('jsonb_populate_record(NULL::josh_push_campaigns, $1::jsonb)');
    });

    it('marketing_workflow.snapshot (stage 5, S5-12) upserts the workflow and its counts; delete leaves a tombstone', async () => {
      const { svc, calls } = ref();
      const data = { workflow: { id: CO, name: 'Winback', status: 'active', trigger_type: 'scheduled', updated_at: 't' },
        enrollmentsByStatus: [{ status: 'completed', n: 3 }], conversions: [{ order_id: 'o1' }] };
      expect(await svc.apply({ type: 'marketing_workflow.snapshot', aggregateId: CO, version: '41', occurredAt: 'x', data })).toBe('applied');
      const insert = calls.find(([sql]) => sql.startsWith('INSERT INTO josh_marketing_workflows'));
      expect(insert?.[1]).toEqual([CO, 'Winback', 'active', 'scheduled', 't', JSON.stringify(data.workflow), '[{"status":"completed","n":3}]',
        '[]', '[]', '[]', '[]', '[{"order_id":"o1"}]', '41']);
      expect(await ref({ tomb: '50' }).svc.apply({ type: 'marketing_workflow.snapshot', aggregateId: CO, version: '45', occurredAt: 'x', data })).toBe('stale');
      await expect(ref().svc.apply({ type: 'marketing_workflow.snapshot', aggregateId: CO, version: '46', occurredAt: 'x', data: { workflow: { id: 'other' } } }))
        .rejects.toBeInstanceOf(BadRequestException);
      const del = ref();
      expect(await del.svc.apply({ type: 'marketing_workflow.deleted', aggregateId: CO, version: '47', occurredAt: 'x', data: { id: CO } })).toBe('applied');
      expect(del.calls.map(([sql]) => sql)).toContain('DELETE FROM josh_marketing_workflows WHERE id = $1');
    });

    it('rejects a snapshot whose data.id is not the aggregate', async () => {
      await expect(ref().svc.apply({ ...company('5'), data: { id: 'other' } })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
