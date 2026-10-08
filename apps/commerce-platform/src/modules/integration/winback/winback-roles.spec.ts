import { isWinbackManager, WINBACK_ASSIGNABLE_ROLES, WINBACK_MANAGER_ROLES, WINBACK_NAMED_ROLES } from './winback-roles';

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
