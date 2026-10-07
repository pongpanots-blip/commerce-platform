import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JoshAdminCallController } from './josh-admin-call.controller';

const req = (role: 'admin' | 'marketing' | 'merchandising' | 'cs') => ({ staff: { userId: 's-1', email: 'x@jagota.co.th', role } }) as never;

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
