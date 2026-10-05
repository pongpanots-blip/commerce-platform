import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JoshAdminCallController } from './josh-admin-call.controller';

const req = (role: 'admin' | 'marketing') => ({ staff: { userId: 's-1', email: 'x@jagota.co.th', role } }) as never;

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
  });

  it('josh 4xx becomes the same kind of error with josh\'s message', async () => {
    const c = new JoshAdminCallController({ run: jest.fn(async () => ({ status: 400, data: { message: ['coupon_code must be a string'] } })) } as never);
    await expect(c.call({ method: 'POST', path: '/coupon', body: {} }, req('admin'))).rejects.toThrow('josh: coupon_code must be a string');
  });
});
