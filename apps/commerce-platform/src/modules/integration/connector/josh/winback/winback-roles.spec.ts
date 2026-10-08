import { isWinbackManager, WINBACK_ASSIGNABLE_ROLES, WINBACK_MANAGER_ROLES } from './winback-roles';

/** Customer-side codes from app_roles (user_type = 'customer'). */
const CUSTOMER_ROLES = ['super_admin', 'staff', 'user'];

describe('winback roles', () => {
  it('never lists a customer role as assignable or manager', () => {
    for (const role of CUSTOMER_ROLES) {
      expect(WINBACK_ASSIGNABLE_ROLES).not.toContain(role);
      expect(WINBACK_MANAGER_ROLES.has(role)).toBe(false);
      expect(isWinbackManager(role)).toBe(false);
    }
  });

  it('lists only the sales team as reps; admins manage but are not reps', () => {
    expect([...WINBACK_ASSIGNABLE_ROLES]).toEqual(['sale', 'sales', 'manager']);
    expect(WINBACK_ASSIGNABLE_ROLES).not.toContain('admin');
    expect(WINBACK_ASSIGNABLE_ROLES).not.toContain('platform_admin');
    expect(isWinbackManager('manager')).toBe(true);
    expect(isWinbackManager('sale')).toBe(false);
  });
});

it.each(['sales_manager', 'sale_manager', ' SALES_MANAGER '])('commerce manager %s sees team scope but is not an assignable rep', role => {
  expect(isWinbackManager(role)).toBe(true);
  expect(WINBACK_ASSIGNABLE_ROLES).not.toContain(role);
});
