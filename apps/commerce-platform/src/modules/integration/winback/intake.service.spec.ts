import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { BrevoEmailService } from './shared/brevo-email.service';
import { IntakeService, generateTmpCustomerCode } from './intake.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';

function makeAccountsRepo() {
  const saved: WinbackAccount[] = [];
  return {
    create: jest.fn((partial: Partial<WinbackAccount>) => partial as WinbackAccount),
    save: jest.fn(async (a: WinbackAccount) => {
      const row = { ...a, id: `acc-${saved.length + 1}` } as WinbackAccount;
      saved.push(row);
      return row;
    }),
    __saved: saved,
  } as unknown as jest.Mocked<Repository<WinbackAccount>> & { __saved: WinbackAccount[] };
}

function makeContactsRepo() {
  const saved: WinbackContact[] = [];
  return {
    create: jest.fn((partial: Partial<WinbackContact>) => partial as WinbackContact),
    save: jest.fn(async (c: WinbackContact) => {
      const row = { ...c, id: `con-${saved.length + 1}` } as WinbackContact;
      saved.push(row);
      return row;
    }),
    __saved: saved,
  } as unknown as jest.Mocked<Repository<WinbackContact>> & { __saved: WinbackContact[] };
}

function makeDataSource(rows: Array<Record<string, unknown>>) {
  return {
    query: jest.fn(async (_sql: string, params: unknown[]) =>
      rows.filter((r) => r.id === params[0]),
    ),
  } as unknown as DataSource;
}

function makeBrevo() {
  return {
    sendWelcomeLeadEmail: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<BrevoEmailService, 'sendWelcomeLeadEmail'>> &
    BrevoEmailService;
}

function makeService(
  repo = makeAccountsRepo(),
  contacts = makeContactsRepo(),
  dataSource = makeDataSource([]),
  brevo = makeBrevo(),
) {
  return {
    service: new IntakeService(repo, contacts, dataSource as never, brevo), // commerce: a JoshReplica (same query(sql, params))
    repo,
    contacts,
    brevo,
  };
}

function dto(overrides: Partial<IntakeLeadDto> = {}): IntakeLeadDto {
  return {
    customer_type: 'b2b_individual',
    display_name: 'สมชาย',
    phone: '0812345678',
    email: 'somchai@example.com',
    cuisine_name: 'ร้านอาหารตามสั่ง',
    ...overrides,
  } as IntakeLeadDto;
}

describe('generateTmpCustomerCode', () => {
  it('starts with TMP- and is uppercase', () => {
    const code = generateTmpCustomerCode(new Date('2026-08-06T00:00:00Z'));
    expect(code.startsWith('TMP-')).toBe(true);
    expect(code).toBe(code.toUpperCase());
  });

  it('produces different codes on consecutive calls at the same instant', () => {
    const now = new Date('2026-08-06T00:00:00Z');
    const codes = new Set(Array.from({ length: 50 }, () => generateTmpCustomerCode(now)));
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe('IntakeService.createTmpLead', () => {
  it('creates a tmp lead in the unassigned pool', async () => {
    const { service, repo } = makeService();

    const result = await service.createTmpLead(dto());

    expect(result.lifecycle).toBe('tmp');
    expect(result.stage).toBe('prospect');
    expect(result.customer_code.startsWith('TMP-')).toBe(true);

    const row = repo.__saved[0];
    expect(row.assigned_sales_user_id).toBeNull();
    expect(row.source).toBe('manual');
    expect(row.lead_source).toBe('website');
    expect(row.phone).toBe('0812345678');
    expect(row.email).toBe('somchai@example.com');
    expect(row.cuisine_name).toBe('ร้านอาหารตามสั่ง');
    expect(row.cuisine_id).toBeNull();
  });

  it('stores company fields for a b2b_company lead', async () => {
    const { service, repo } = makeService();

    await service.createTmpLead(
      dto({ customer_type: 'b2b_company', company_name: 'บริษัท ทดสอบ จำกัด', restaurant_name: 'ครัวคุณแม่' }),
    );

    const row = repo.__saved[0];
    expect(row.customer_type).toBe('b2b_company');
    expect(row.company_name).toBe('บริษัท ทดสอบ จำกัด');
    expect(row.restaurant_name).toBe('ครัวคุณแม่');
    expect(row.display_name).toBe('ครัวคุณแม่');
  });

  it('resolves cuisine_id to its name and parent', async () => {
    const dataSource = makeDataSource([
      { id: 'cui-child', parent_id: 'cui-parent', cuisine_name: 'ซูชิ' },
      { id: 'cui-parent', parent_id: null, cuisine_name: 'อาหารญี่ปุ่น' },
    ]);
    const { service, repo } = makeService(makeAccountsRepo(), makeContactsRepo(), dataSource);

    await service.createTmpLead(dto({ cuisine_id: 'cui-child', cuisine_name: undefined }));

    const row = repo.__saved[0];
    expect(row.cuisine_id).toBe('cui-child');
    expect(row.cuisine_name).toBe('ซูชิ');
    expect(row.cuisine_parent_id).toBe('cui-parent');
    expect(row.cuisine_parent_name).toBe('อาหารญี่ปุ่น');
  });

  it('rejects a cuisine_id that does not resolve', async () => {
    const { service } = makeService();

    await expect(service.createTmpLead(dto({ cuisine_id: 'missing' }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('creates two separate rows for the same phone number', async () => {
    const { service, repo } = makeService();

    const first = await service.createTmpLead(dto());
    const second = await service.createTmpLead(dto());

    expect(repo.__saved).toHaveLength(2);
    expect(first.customer_code).not.toBe(second.customer_code);
  });

  it('writes a contact row with the person\'s name even when restaurant_name is present', async () => {
    const { service, repo, contacts } = makeService();

    await service.createTmpLead(dto({ restaurant_name: 'ครัวคุณแม่' }));

    const account = repo.__saved[0];
    expect(account.display_name).toBe('ครัวคุณแม่');

    const contact = contacts.__saved[0];
    expect(contact.account_id).toBe(account.id);
    expect(contact.name).toBe('สมชาย');
  });

  it('defaults customer_type to b2b_company for a form that does not ask', async () => {
    const { service, repo } = makeService();

    await service.createTmpLead(dto({ customer_type: undefined }));

    expect(repo.__saved[0].customer_type).toBe('b2b_company');
  });

  it('stamps consent_at when the form says the lead agreed', async () => {
    const { service, repo } = makeService();

    await service.createTmpLead(dto({ consent: true }));
    expect(repo.__saved[0].consent_at).toBeInstanceOf(Date);

    await service.createTmpLead(dto({ consent: undefined }));
    expect(repo.__saved[1].consent_at).toBeNull();
  });

  it('carries the phone and whichever of email/line_id was supplied onto the contact', async () => {
    const { service, contacts } = makeService();

    await service.createTmpLead(dto({ email: 'somchai@example.com' }));
    const withEmail = contacts.__saved[0];
    expect(withEmail.mobile).toBe('0812345678');
    expect(withEmail.email).toBe('somchai@example.com');
    expect(withEmail.line_id).toBeNull();

    await service.createTmpLead(dto({ email: undefined, line_id: 'somchai_line' }));
    const withLineId = contacts.__saved[1];
    expect(withLineId.mobile).toBe('0812345678');
    expect(withLineId.email).toBeNull();
    expect(withLineId.line_id).toBe('somchai_line');
  });

  it('sends a welcome email when the lead has an email', async () => {
    const { service, brevo } = makeService();

    await service.createTmpLead(dto({ email: 'owner@example.com', locale: 'th' }));

    expect(brevo.sendWelcomeLeadEmail).toHaveBeenCalledWith({
      toEmail: 'owner@example.com',
      locale: 'th',
    });
  });

  it('skips welcome email when only line_id is present', async () => {
    const { service, brevo } = makeService();

    await service.createTmpLead(dto({ email: undefined, line_id: 'somchai_line' }));

    expect(brevo.sendWelcomeLeadEmail).not.toHaveBeenCalled();
  });

  it('still returns the lead when welcome email fails', async () => {
    const brevo = makeBrevo();
    brevo.sendWelcomeLeadEmail.mockRejectedValue(new Error('Brevo down'));
    const { service, repo } = makeService(
      makeAccountsRepo(),
      makeContactsRepo(),
      makeDataSource([]),
      brevo,
    );

    const result = await service.createTmpLead(dto());

    expect(result.id).toBe(repo.__saved[0].id);
    expect(brevo.sendWelcomeLeadEmail).toHaveBeenCalled();
  });
});
