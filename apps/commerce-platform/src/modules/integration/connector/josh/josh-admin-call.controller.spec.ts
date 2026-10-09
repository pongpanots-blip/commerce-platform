import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JoshAdminCallController, joshAdminCall } from './josh-admin-call.controller';

const req = (role: 'admin' | 'marketing' | 'merchandising' | 'cs' | 'graphic') => ({ staff: { userId: 's-1', email: 'x@jagota.co.th', role } }) as never;

describe('JoshAdminCallController', () => {
  it('passes josh admin routes through and unwraps josh\'s answer', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: { id: 'c-1' } })) };
    const c = new JoshAdminCallController(josh as never);
    expect(await c.call({ method: 'post', path: '/coupon', body: { coupon_code: 'A' } }, req('marketing'))).toEqual({ id: 'c-1' });
    expect(josh.run).toHaveBeenCalledWith('admin-call', 'call', { method: 'POST', path: '/coupon', query: undefined, body: { coupon_code: 'A' }, files: undefined },
      { userId: 's-1', email: 'x@jagota.co.th' }, 'admin');
  });

  it('refuses paths outside the josh admin areas, traversal, and CS routes for marketing', async () => {
    const c = new JoshAdminCallController({ run: jest.fn() } as never);
    await expect(c.call({ method: 'POST', path: '/auth/login' }, req('admin'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.call({ method: 'GET', path: '/coupon/../users' }, req('admin'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.call({ method: 'POST', path: '/cs-admin/accounts/merge' }, req('marketing'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.call({ method: 'PUT', path: '/admin/cart-move-allowed-categories' }, req('marketing'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.call({ method: 'GET', path: '/admin/cart-move-allowed-categories/x' }, req('admin'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('marketing edits a banner by id; other banner sub-paths and other roles stay out', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const c = new JoshAdminCallController(josh as never);
    await c.call({ method: 'PATCH', path: '/banner/11111111-1111-4111-8111-111111111111' }, req('marketing'));
    expect(josh.run).toHaveBeenCalledTimes(1);
    await expect(c.call({ method: 'PATCH', path: '/banner/criteria' }, req('marketing'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.call({ method: 'PATCH', path: '/banner/11111111-1111-4111-8111-111111111111' }, req('cs'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('CS tools (delivery schedule, cart-move categories) are admin calls', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: [] })) };
    const c = new JoshAdminCallController(josh as never);
    await c.call({ method: 'PUT', path: '/admin/cart-move-allowed-categories', body: { categoryIds: [] } }, req('admin'));
    await c.call({ method: 'GET', path: '/cs-admin/delivery-schedule' }, req('admin'));
    expect(josh.run).toHaveBeenCalledTimes(2);
  });

  it('stage 6: MER reaches the product areas, CS the order / CS-desk areas, neither reaches PII or staff access', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const c = new JoshAdminCallController(josh as never);
    await c.call({ method: 'PATCH', path: '/product/p-1' }, req('merchandising'));
    await c.call({ method: 'POST', path: '/product-category' }, req('merchandising'));
    await c.call({ method: 'GET', path: '/supplier' }, req('merchandising'));
    await c.call({ method: 'GET', path: '/orders' }, req('cs'));
    await c.call({ method: 'GET', path: '/cs-admin/delivery-schedule' }, req('cs'));
    await c.call({ method: 'GET', path: '/credit-notes' }, req('cs'));
    expect(josh.run).toHaveBeenCalledTimes(6);
    for (const [role, path] of [['merchandising', '/orders'], ['merchandising', '/coupon'], ['cs', '/product/p-1'], ['cs', '/coupon'],
      ['cs', '/users'], ['merchandising', '/pii/reveal'], ['cs', '/admin-access/requests'], ['cs', '/payment/kbank/testing'], ['marketing', '/orders']] as const) {
      await expect(c.call({ method: 'GET', path }, req(role))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('graphic reads products and categories, uploads images, and cannot write the catalog or reach PII', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const c = new JoshAdminCallController(josh as never);
    await c.call({ method: 'GET', path: '/product/admin/list' }, req('graphic'));
    await c.call({ method: 'GET', path: '/product-category' }, req('graphic'));
    await c.call({ method: 'GET', path: '/brands' }, req('graphic'));
    await c.call({ method: 'POST', path: '/upload/image' }, req('graphic'));
    await c.call({ method: 'POST', path: '/product/images/bulk-upload' }, req('graphic'));
    expect(josh.run).toHaveBeenCalledTimes(5);
    for (const [method, path] of [['PATCH', '/product/p-1'], ['POST', '/product'], ['POST', '/product-category'], ['GET', '/users'], ['GET', '/orders']] as const) {
      await expect(c.call({ method, path }, req('graphic'))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  const U = '0b7c9a2e-5d1f-4c3b-9a8e-1f2d3c4b5a6e';
  /** Every relay call a cs page makes (CsDesk, OrderDetail, Order, Shipments, ShipmentDetail, credit notes / backs, /j/cs/*). */
  const CS_UI_CALLS: [string, string][] = [
    ['POST', '/cs-admin/orders/quote'], ['POST', '/cs-admin/orders/place-on-behalf'],
    ['GET', '/cs-admin/sample-requests'], ['PATCH', `/cs-admin/sample-requests/${U}`],
    ['GET', `/cs-admin/orders/${U}/payment-qr`], ['GET', '/cs-admin/refunds'], ['POST', '/cs-admin/refunds'],
    ['GET', '/cs-admin/delivery-schedule'], ['GET', '/admin/cart-move-allowed-categories'], ['PUT', '/admin/cart-move-allowed-categories'],
    ['GET', '/orders'], ['GET', '/orders/analytics'], ['GET', `/orders/${U}`], ['PATCH', `/orders/${U}/status`],
    ['GET', '/shipments'], ['GET', '/shipments/analytics'], ['GET', `/shipments/${U}`], ['GET', `/shipments/by-order/${U}`],
    ['PATCH', `/shipments/${U}/status`], ['POST', `/shipments/${U}/send`],
    ['GET', '/credit-notes'], ['GET', `/credit-notes/${U}`], ['GET', '/credit-backs'], ['GET', `/credit-backs/${U}`],
  ];
  /** Reachable by cs before (cs-admin/ prefix, orders|shipments and credit-notes|backs with any method); admin only now. */
  const CS_REFUSED: [string, string][] = [
    ['POST', '/cs-admin/accounts/merge'], ['PATCH', `/cs-admin/users/${U}`], ['POST', '/cs-admin/users'], ['PATCH', `/cs-admin/branches/${U}`],
    ['POST', '/cs-admin/branches'], ['PATCH', '/cs-admin/sales-assignment'], ['PATCH', `/cs-admin/refunds/${U}`],
    ['GET', '/cs-admin/credit-applications'], ['PATCH', `/cs-admin/credit-applications/${U}`], ['GET', '/cs-admin/billing/companies'],
    ['GET', `/cs-admin/billing/companies/${U}`], ['GET', '/cs-admin/price-requests'], ['PATCH', `/cs-admin/price-requests/${U}`],
    ['GET', '/cs-admin/active-offers'], ['GET', '/cs-admin/invoices/overdue'], ['POST', '/cs-admin/companies'],
    ['GET', `/cs-admin/users/${U}/search-history`], ['POST', '/cs-admin/products/resolve-skus'], ['POST', '/cs-admin/sample-requests'],
    ['DELETE', `/cs-admin/sample-requests/${U}`], ['PATCH', '/cs-admin/sample-requests/not-an-id'],
    ['POST', '/orders/import'], ['POST', '/orders/import/relink-users'], ['POST', '/orders/import/relink-all'],
    ['DELETE', `/orders/${U}`], ['PATCH', `/orders/${U}`], ['GET', `/orders/${U}/a/b`], ['POST', '/credit-notes'], ['PATCH', `/credit-backs/${U}`],
    ['POST', '/admin/cart-move-allowed-categories'],
  ];

  it('cs reaches exactly the calls its pages make', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const c = new JoshAdminCallController(josh as never);
    for (const [method, path] of CS_UI_CALLS) await c.call({ method, path }, req('cs'));
    expect(josh.run).toHaveBeenCalledTimes(CS_UI_CALLS.length);
  });

  it('cs no longer reaches account merge, customer users / branches, credit decisions, billing, refund decisions or order import (admin still does)', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const c = new JoshAdminCallController(josh as never);
    for (const [method, path] of CS_REFUSED) {
      await expect(c.call({ method, path }, req('cs'))).rejects.toThrow('admin only');
      await c.call({ method, path }, req('admin'));
    }
    expect(josh.run).toHaveBeenCalledTimes(CS_REFUSED.length);
  });

  it('graphic lists products but cannot read a product, its customer prices or cuisines; MER and marketing still can', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const c = new JoshAdminCallController(josh as never);
    await c.call({ method: 'GET', path: '/product/admin/list' }, req('graphic'));
    await c.call({ method: 'GET', path: '/product/images/bulk-upload/logs' }, req('graphic'));
    await c.call({ method: 'POST', path: '/product/images/bulk-upload/prune-superseded' }, req('graphic'));
    for (const path of [`/product/${U}/customer-prices`, `/product/${U}`, `/product/${U}/cuisines`, `/product/${U}/promotion-lock`]) {
      await expect(c.call({ method: 'GET', path }, req('graphic'))).rejects.toThrow('admin only');
      await c.call({ method: 'GET', path }, req('merchandising'));
      await c.call({ method: 'GET', path }, req('marketing'));
    }
    expect(josh.run).toHaveBeenCalledTimes(3 + 4 * 2);
  });

  it('the shared joshAdminCall (MCP, growth) applies the same rules', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const cs = { userId: 's-1', email: 'x@jagota.co.th', role: 'cs' };
    await expect(joshAdminCall(josh as never, cs, { method: 'POST', path: '/cs-admin/accounts/merge' }, 'mcp')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(joshAdminCall(josh as never, { ...cs, role: 'graphic' }, { method: 'GET', path: `/product/${U}/customer-prices` }, 'mcp')).rejects.toBeInstanceOf(ForbiddenException);
    await joshAdminCall(josh as never, cs, { method: 'GET', path: '/cs-admin/sample-requests' }, 'mcp');
    expect(josh.run).toHaveBeenCalledWith('admin-call', 'call', expect.objectContaining({ method: 'GET', path: '/cs-admin/sample-requests' }), { userId: 's-1', email: 'x@jagota.co.th' }, 'mcp');
  });

  it('marketing keeps its areas (product, upload, coupons)', async () => {
    const josh = { run: jest.fn(async () => ({ status: 200, data: {} })) };
    const c = new JoshAdminCallController(josh as never);
    for (const path of ['/product/p-1', '/upload/image', '/coupon', '/product-category', '/admin/audit-logs']) await c.call({ method: 'GET', path }, req('marketing'));
    expect(josh.run).toHaveBeenCalledTimes(5);
  });

  it('josh 4xx becomes the same kind of error with josh\'s message', async () => {
    const c = new JoshAdminCallController({ run: jest.fn(async () => ({ status: 400, data: { message: ['coupon_code must be a string'] } })) } as never);
    await expect(c.call({ method: 'POST', path: '/coupon', body: {} }, req('admin'))).rejects.toThrow('josh: coupon_code must be a string');
  });
});
