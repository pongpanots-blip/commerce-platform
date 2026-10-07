import { getField, SEGMENT_FIELDS } from './segment-fields';

describe('segment-fields registry', () => {
  it('resolves lifetime_spend to the COALESCE sql expression', () => {
    expect(getField('lifetime_spend').sqlExpr).toBe('COALESCE(m.lifetime_spend,0)');
  });

  it('throws a descriptive error for an unknown field key', () => {
    expect(() => getField('not_a_real_field')).toThrow(
      'Unknown segment field: not_a_real_field',
    );
  });

  it('maps last_order_days_ago to the never-ordered-safe date-diff expression', () => {
    const field = getField('last_order_days_ago');
    expect(field.valueType).toBe('number');
    expect(field.sqlExpr).toBe(
      'COALESCE(EXTRACT(DAY FROM now() - m.last_order_at), 999999)',
    );
  });

  it('maps registered_days_ago to a date-diff expression off u.created_at', () => {
    const field = getField('registered_days_ago');
    expect(field.valueType).toBe('number');
    expect(field.sqlExpr).toBe(
      'COALESCE(EXTRACT(DAY FROM now() - u.created_at), 999999)',
    );
  });

  it('exposes tier as an enum field backed by the tiers options source', () => {
    const field = getField('tier');
    expect(field.valueType).toBe('enum');
    expect(field.optionsSource).toBe('tiers');
    expect(field.sqlExpr).toBe('t.slug');
    expect(field.operators).toEqual(['=', '!=', 'in']);
  });

  it('exposes has_company as a boolean-shaped enum field with only "=" allowed', () => {
    const field = getField('has_company');
    expect(field.valueType).toBe('enum');
    expect(field.sqlExpr).toBe('(u.company_id IS NOT NULL)');
    expect(field.operators).toEqual(['=']);
  });

  it('exposes cuisine with the cuisine options source, pending the Task 6 join', () => {
    const field = getField('cuisine');
    expect(field.optionsSource).toBe('cuisine');
    expect(field.valueType).toBe('enum');
  });

  it('exposes cuisine_group backed by the cuisine_group options source, comparing on the parent_id column as text', () => {
    const field = getField('cuisine_group');
    expect(field.valueType).toBe('enum');
    expect(field.optionsSource).toBe('cuisine_group');
    expect(field.sqlExpr).toBe('cy.parent_id::text');
    expect(field.operators).toEqual(['=', '!=', 'in']);
  });

  it('restricts manual_user_ids to the "in" operator', () => {
    const field = getField('manual_user_ids');
    expect(field.operators).toEqual(['in']);
    expect(field.sqlExpr).toBe('u.id');
  });

  it('registers every declared field under its own key', () => {
    for (const [key, def] of Object.entries(SEGMENT_FIELDS)) {
      expect(def.key).toBe(key);
    }
  });
});
