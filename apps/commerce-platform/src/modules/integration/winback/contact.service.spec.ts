import { ContactService } from './contact.service';

describe('ContactService PII masking', () => {
  // Win-back sales are internal staff, never the data subject — always
  // masked; full values go through the audited POST /api/pii/reveal.
  it('masks name/mobile/email in list()', async () => {
    const contacts = {
      find: jest.fn().mockResolvedValue([
        { id: 'c-1', name: 'สมหญิง รักดี', mobile: '0985496936', email: 'somying@gmail.com' },
      ]),
    };
    const service = new ContactService(contacts as any);

    const result = await service.list('acc-1');

    expect(result[0].name).toBe('สมหญิง ร.');
    expect(result[0].mobile).toBe('098-***6936');
    expect(result[0].email).toBe('so***@gmail.com');
  });
});

describe('ContactService.update (PATCH /winback/contacts/:contactId)', () => {
  const stored = () => ({
    id: 'c-1', account_id: 'acc-1', team: 'kitchen', name: 'สมหญิง รักดี', role_label: 'เชฟ',
    mobile: '0985496936', email: 'somying@gmail.com', line_id: 'somying', whatsapp: null,
  });
  function build() {
    const row = stored();
    const contacts = { findOne: jest.fn(async () => row), save: jest.fn(async (r: any) => r) };
    return { service: new ContactService(contacts as any), row, contacts };
  }

  it('is a true partial update: a role change leaves mobile/email/name untouched', async () => {
    const { service, row } = build();
    const result = await service.update('c-1', { role_label: 'ผู้จัดการ' });
    expect(row.role_label).toBe('ผู้จัดการ');
    expect(row.mobile).toBe('0985496936');
    expect(row.email).toBe('somying@gmail.com');
    expect(row.name).toBe('สมหญิง รักดี');
    // response is masked like every read
    expect(result.mobile).toBe('098-***6936');
  });

  it('refuses the masked mobile/email a read returned, so a full-form client fails loudly instead of destroying data', async () => {
    const { service, row } = build();
    await expect(service.update('c-1', { role_label: 'x', mobile: '098-***6936', email: 'so***@gmail.com' })).rejects.toThrow(
      /email, mobile/,
    );
    expect(row.mobile).toBe('0985496936');
  });
});
