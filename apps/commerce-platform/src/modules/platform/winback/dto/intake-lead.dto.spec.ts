import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IntakeLeadDto } from './intake-lead.dto';

/**
 * The DTO *is* the rule for what a public form must collect, and the rule has
 * moved twice. These pin the current shape: what the endpoint refuses, and the
 * one field it fills in for a form that can't ask.
 */
function errorsFor(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(IntakeLeadDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);
}

const complete = {
  display_name: 'สมชาย',
  phone: '0812345678',
  email: 'somchai@example.com',
  cuisine_name: 'Thai',
};

describe('IntakeLeadDto', () => {
  it('accepts the minimum a public form has to collect', () => {
    expect(errorsFor(complete)).toEqual([]);
  });

  it.each(['display_name', 'phone', 'cuisine_name'])('requires %s', (field) => {
    const { [field]: _dropped, ...rest } = complete as Record<string, unknown>;
    expect(errorsFor(rest)).toContain(field);
  });

  it('takes a bare Thai mobile (10) or landline (9) and nothing else', () => {
    for (const ok of ['0812345678', '021234567', '053123456']) {
      expect(errorsFor({ ...complete, phone: ok })).toEqual([]);
    }
    // Separators are the caller's to strip — landing's route does it before
    // posting, so what arrives here is always normalised.
    for (const bad of [
      '081-234-5678',
      '081 234 5678',
      '08123456789',
      '0812345',
      'โทรมา',
    ]) {
      expect(errorsFor({ ...complete, phone: bad })).toContain('phone');
    }
  });

  it('takes email or line_id, but not neither', () => {
    const { email: _dropped, ...noEmail } = complete;
    expect(errorsFor({ ...noEmail, line_id: 'somchai_line' })).toEqual([]);
    expect(errorsFor(noEmail)).toContain('email');
  });

  it('lets customer_type be omitted, but not invented', () => {
    expect(errorsFor(complete)).toEqual([]);
    expect(errorsFor({ ...complete, customer_type: 'b2c' })).toContain(
      'customer_type',
    );
  });

  it('accepts locale en|th and rejects other values', () => {
    expect(errorsFor({ ...complete, locale: 'en' })).toEqual([]);
    expect(errorsFor({ ...complete, locale: 'th' })).toEqual([]);
    expect(errorsFor({ ...complete, locale: 'fr' })).toContain('locale');
  });
});
