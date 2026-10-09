import { WebhookSubscriptionService } from './webhook-subscription.service';

interface Row {
  id: string;
  active: boolean;
  eventTypes: string[];
  accountId: string | null;
}

/**
 * Minimal stand-in for the query builder `matching()` builds: it evaluates the
 * clauses the service actually adds against in-memory rows, and throws on any
 * clause it does not know so a changed query cannot silently pass.
 */
function makeService(rows: Row[]) {
  const clauses: string[] = [];
  const qb = {
    params: {} as Record<string, unknown>,
    where(sql: string, params?: Record<string, unknown>) {
      clauses.push(sql);
      Object.assign(this.params, params);
      return this;
    },
    andWhere(sql: string, params?: Record<string, unknown>) {
      return this.where(sql, params);
    },
    async getMany() {
      const one = JSON.parse(this.params.one as string)[0] as string;
      return rows.filter((r) =>
        clauses.every((sql) => {
          if (sql === 's.active = :active') return r.active === this.params.active;
          if (sql.includes('s.event_types @> CAST(:one AS jsonb)')) {
            return r.eventTypes.includes(one) || r.eventTypes.includes('*');
          }
          if (sql === 's.account_id IS NULL') return r.accountId === null;
          throw new Error(`unexpected clause: ${sql}`);
        }),
      );
    },
  };
  const subs = { createQueryBuilder: jest.fn(() => qb) };
  return new WebhookSubscriptionService(subs as never, {} as never, {} as never);
}

const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

describe('WebhookSubscriptionService.matching', () => {
  const rows: Row[] = [
    { id: 'admin-customer', active: true, eventTypes: ['customer.updated'], accountId: null },
    { id: 'admin-all', active: true, eventTypes: ['*'], accountId: null },
    { id: 'admin-off', active: false, eventTypes: ['*'], accountId: null },
    { id: 'portal-order', active: true, eventTypes: ['order.confirmed'], accountId: 'acc1' },
    { id: 'portal-customer', active: true, eventTypes: ['customer.updated', 'erp.sale-order.created'], accountId: 'acc1' },
    { id: 'portal-all', active: true, eventTypes: ['*'], accountId: 'acc2' },
  ];

  it('admin subscriptions still get every event they ask for, including customer/ERP ones', async () => {
    const service = makeService(rows);
    expect(ids(await service.matching('customer.updated'))).toEqual(['admin-all', 'admin-customer']);
    expect(ids(await service.matching('erp.sale-order.created'))).toEqual(['admin-all']);
    expect(ids(await service.matching('staff.access'))).toEqual(['admin-all']);
  });

  it('portal subscriptions get allowlisted events they subscribed to', async () => {
    const service = makeService(rows);
    expect(ids(await service.matching('order.confirmed'))).toEqual(['admin-all', 'portal-all', 'portal-order']);
  });

  it('portal subscriptions never get customer/ERP sale-order events, even if subscribed', async () => {
    const service = makeService(rows);
    for (const type of ['customer.updated', 'customer.created', 'erp.sale-order.created']) {
      const matched = await service.matching(type);
      expect(matched.filter((r) => r.accountId !== null)).toEqual([]);
    }
  });

  it('portal "*" expands to the portal allowlist only', async () => {
    const service = makeService(rows);
    expect(ids(await service.matching('inventory.updated'))).toEqual(['admin-all', 'portal-all']);
    expect(ids(await service.matching('segment.members'))).toEqual(['admin-all']);
    expect(ids(await service.matching('winback.row'))).toEqual(['admin-all']);
  });
});
