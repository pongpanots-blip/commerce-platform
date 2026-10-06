import { BadRequestException } from '@nestjs/common';
import { maskWinbackAccountPii, rejectMaskedPiiValues } from './winback-pii.helpers';

describe('maskWinbackAccountPii', () => {
  it('masks phone, email and all three identity numbers, leaves the rest alone', () => {
    const masked = maskWinbackAccountPii({
      id: 'acc-1',
      display_name: 'ร้าน A',
      phone: '0985496936',
      email: 'somchai@gmail.com',
      company_registration_num: '0105560000123',
      register_number: '5412430744195',
      id_card_number: '1100000000123',
      customer_type: 'b2b_company',
    } as any);
    expect(masked).toMatchObject({
      id: 'acc-1',
      display_name: 'ร้าน A',
      customer_type: 'b2b_company',
      phone: '098-***6936',
      email: 'so***@gmail.com',
      company_registration_num: '010******0123',
      register_number: '541******4195',
      id_card_number: '110******0123',
    });
  });

  it('keeps null as null so a client can still tell "never filled in" from "has a value"', () => {
    const masked = maskWinbackAccountPii({ company_registration_num: null, id_card_number: null, register_number: null } as any);
    expect(masked.company_registration_num).toBeNull();
    expect(masked.id_card_number).toBeNull();
    expect(masked.register_number).toBeNull();
  });
});

describe('rejectMaskedPiiValues', () => {
  it('refuses a masked identity number echoed back into PATCH, naming the field', () => {
    expect(() => rejectMaskedPiiValues({ id_card_number: '110******0123' })).toThrow(
      new BadRequestException('id_card_number เป็นค่าที่ถูก mask ไม่ใช่ข้อมูล — ส่งค่าเต็มมา หรือไม่ต้องส่ง field นี้'),
    );
  });

  it('refuses the exact masks the account read produces for phone and email', () => {
    const read = maskWinbackAccountPii({ phone: '0985496936', email: 'somchai@gmail.com' } as any);
    expect(() => rejectMaskedPiiValues({ phone: read.phone })).toThrow(BadRequestException);
    expect(() => rejectMaskedPiiValues({ email: read.email })).toThrow(BadRequestException);
    // an edit form that submits everything after a masked read — the case that destroys data
    expect(() => rejectMaskedPiiValues({ operation_hours: '10:00-20:00', phone: read.phone, email: read.email })).toThrow(
      /phone, email/,
    );
  });

  it('refuses a masked contact mobile (PATCH /contacts/:id)', () => {
    expect(() => rejectMaskedPiiValues({ mobile: '098-***6936' })).toThrow(/mobile/);
  });

  it('accepts full values, nulls and unrelated fields', () => {
    expect(() => rejectMaskedPiiValues({ id_card_number: '1100000000123', phone: '0812345678', email: 'a@b.co' })).not.toThrow();
    expect(() => rejectMaskedPiiValues({ phone: null, email: null })).not.toThrow();
    expect(() => rejectMaskedPiiValues({ note: 'a * b' })).not.toThrow();
  });
});
