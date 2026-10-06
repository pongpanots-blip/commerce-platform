import { BadRequestException } from '@nestjs/common';
import { promoteBlockers, promoteIfRegistered } from './lifecycle.helpers';
import { LeadService } from './lead.service';

const complete = {
  customer_type: 'b2b_company', company_registration_num: '0105560000000', id_card_number: null,
  phone: '0812345678', address: 'เขตบางรัก',
};

describe('promoteBlockers', () => {
  it('is empty for a workable company lead with a contact', () => {
    expect(promoteBlockers(complete as any, 1)).toEqual([]);
  });

  it('names every missing thing at once, identity number chosen by customer_type', () => {
    expect(promoteBlockers({ ...complete, company_registration_num: '  ', phone: null, address: '' } as any, 0)).toEqual([
      'company_registration_num', 'phone', 'address', 'contacts',
    ]);
    expect(promoteBlockers({ ...complete, customer_type: 'b2b_individual', id_card_number: null } as any, 1)).toEqual(['id_card_number']);
  });

  it('a Market Explorer lead straight after claiming is blocked on everything', () => {
    expect(promoteBlockers({ customer_type: 'b2b_company', company_registration_num: null, id_card_number: null, phone: null, address: 'เขตวัฒนา' } as any, 0)).toEqual([
      'company_registration_num', 'phone', 'contacts',
    ]);
  });
});

describe('LeadService.promoteToLead', () => {
  function build(account: any, contactCount: number) {
    const accounts = { findOne: jest.fn(async () => account), save: jest.fn(async (a: any) => a) };
    const contacts = { count: jest.fn(async () => contactCount) };
    const service = new LeadService(accounts as any, contacts as any, {} as any, {} as any, {} as any, {} as any);
    return { service, accounts };
  }

  it('refuses with one 400 listing the Thai labels of everything missing', async () => {
    const { service, accounts } = build({ id: 'a1', lifecycle: 'tmp', ...complete, company_registration_num: null, phone: null }, 0);
    await expect(service.promoteToLead('a1')).rejects.toThrow(
      new BadRequestException('ลูกค้ารายนี้ยังกรอกข้อมูลไม่ครบ: เลขทะเบียนบริษัท, เบอร์โทร, ผู้ติดต่ออย่างน้อย 1 คน'),
    );
    expect(accounts.save).not.toHaveBeenCalled();
  });

  it('promotes a complete lead', async () => {
    const { service, accounts } = build({ id: 'a1', lifecycle: 'tmp', promoted_to_lead_at: null, ...complete }, 1);
    const result = await service.promoteToLead('a1');
    expect(result.lifecycle).toBe('lead');
    expect(accounts.save).toHaveBeenCalled();
  });
});

describe('automatic promotion is not held to the rule', () => {
  it('promoteIfRegistered promotes an incomplete lead once the Josh app user has logged in', () => {
    const account: any = { lifecycle: 'tmp', josh_user_id: 'u1', promoted_to_lead_at: null, customer_type: 'b2b_company', company_registration_num: null, phone: null, address: null };
    expect(promoteIfRegistered(account, { lastAppLoginAt: new Date() })).toBe(true);
    expect(account.lifecycle).toBe('lead');
  });
});
