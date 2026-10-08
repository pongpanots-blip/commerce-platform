import { isWinbackManager, WINBACK_ASSIGNABLE_ROLES, WINBACK_MANAGER_ROLES, WINBACK_NAMED_ROLES } from './winback-roles';
import { ForbiddenException } from '@nestjs/common';
import { WinbackAppRoleGuard } from './winback-app-role.guard';

/** Customer-side codes from app_roles (user_type = 'customer'). */
const CUSTOMER_ROLES = ['super_admin', 'staff', 'user'];

describe('winback roles', () => {
  it('never lists a customer role as assignable or manager', () => {
    for (const role of CUSTOMER_ROLES) {
      expect(WINBACK_ASSIGNABLE_ROLES).not.toContain(role);
      expect(WINBACK_MANAGER_ROLES.has(role)).toBe(false);
      expect(isWinbackManager(role)).toBe(false);
      expect(WINBACK_NAMED_ROLES).not.toContain(role);
    }
  });

  it('lists only the sales team as reps; admins manage but are not reps', () => {
    expect([...WINBACK_ASSIGNABLE_ROLES]).toEqual(['sale', 'sales', 'manager']);
    expect(WINBACK_ASSIGNABLE_ROLES).not.toContain('admin');
    expect(WINBACK_ASSIGNABLE_ROLES).not.toContain('platform_admin');
    expect(isWinbackManager('manager')).toBe(true);
    expect(isWinbackManager('sale')).toBe(false);
  });

  it('names are resolved for the sales team plus the admins who act as managers', () => {
    expect([...WINBACK_NAMED_ROLES]).toEqual(['sale', 'sales', 'manager', 'admin', 'platform_admin']);
  });
});

describe('WinbackAppRoleGuard', () => {
  const guard = new WinbackAppRoleGuard();
  const ctx = (role?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ user: role === undefined ? undefined : { role } }) }) }) as never;

  it.each(['cs', 'marketing', 'dev', 'merchandising', undefined, ''])('403 for %s', (role) => {
    expect(() => guard.canActivate(ctx(role))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(role))).toThrow('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้');
  });

  it.each(['sale', 'sales', 'manager', 'admin', 'platform_admin'])('allows %s', (role) => {
    expect(guard.canActivate(ctx(role))).toBe(true);
  });

  it('does not accept an unverified Bearer role when req.user has no role', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'rep-1', role: 'admin' })).toString('base64url');
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer e30.${payload}.fake` } }) }) } as never;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
