import { BadRequestException } from '@nestjs/common';
import { assertIdentityPairOnTypeChange } from './lead.service';

const company = { customer_type: 'b2b_company', company_name: 'บจก. เดิม', company_registration_num: '0105560000000', id_card_number: null };
const placeLead = { customer_type: 'b2b_company', company_name: null, company_registration_num: null, id_card_number: null };
const individual = { customer_type: 'b2b_individual', company_name: null, company_registration_num: null, id_card_number: '1100000000000' };

describe('assertIdentityPairOnTypeChange (PATCH /winback/account/:id)', () => {
  it('never blocks an edit that does not change the type, even on a half-filled Market Explorer lead', () => {
    expect(() => assertIdentityPairOnTypeChange(placeLead, { phone: '0812345678' } as any)).not.toThrow();
    expect(() => assertIdentityPairOnTypeChange(placeLead, { company_registration_num: '0105560000000' } as any)).not.toThrow();
    expect(() => assertIdentityPairOnTypeChange(company, { customer_type: 'b2b_company' } as any)).not.toThrow();
  });

  it('rejects a bare switch to b2b_individual and names the missing field', () => {
    expect(() => assertIdentityPairOnTypeChange(placeLead, { customer_type: 'b2b_individual' } as any)).toThrow(
      new BadRequestException('เปลี่ยน customer_type เป็น b2b_individual ต้องส่ง id_card_number มาด้วย'),
    );
    expect(() =>
      assertIdentityPairOnTypeChange(placeLead, { customer_type: 'b2b_individual', id_card_number: '1100000000000' } as any),
    ).not.toThrow();
  });

  it('rejects a bare switch to b2b_company and names both missing fields', () => {
    expect(() => assertIdentityPairOnTypeChange(individual, { customer_type: 'b2b_company' } as any)).toThrow(
      new BadRequestException('เปลี่ยน customer_type เป็น b2b_company ต้องส่ง company_name, company_registration_num มาด้วย'),
    );
    expect(() => assertIdentityPairOnTypeChange(individual, { customer_type: 'b2b_company', company_name: 'บจก. ใหม่' } as any)).toThrow(
      BadRequestException,
    );
  });

  it('counts values already stored, so a switch back needs nothing extra', () => {
    const wasCompany = { ...company, customer_type: 'b2b_individual', id_card_number: '1100000000000' };
    expect(() => assertIdentityPairOnTypeChange(wasCompany, { customer_type: 'b2b_company' } as any)).not.toThrow();
  });

  it('treats an empty string in the request as missing', () => {
    expect(() =>
      assertIdentityPairOnTypeChange(company, { customer_type: 'b2b_individual', id_card_number: '   ' } as any),
    ).toThrow(BadRequestException);
  });
});
