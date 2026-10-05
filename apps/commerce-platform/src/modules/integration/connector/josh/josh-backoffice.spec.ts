import { BadRequestException } from '@nestjs/common';
import { BACKOFFICE_VIEWS, backofficeQuery, maskRow } from './josh-backoffice';

describe('josh back-office lists', () => {
  it('never select secrets or files: password hashes, KYC file keys, gateway payloads, card data', () => {
    const sql = JSON.stringify(Object.values(BACKOFFICE_VIEWS).map((v) => v.columns.map((c) => c.sql)));
    for (const secret of ['password_hash', 'object_key', 'gateway_response', 'card_', 'pod_signature', 'pod_photo']) expect(sql).not.toContain(secret);
  });

  it('search is one bound parameter across the view\'s columns; status is bound too', () => {
    const q = backofficeQuery(BACKOFFICE_VIEWS.shipments, { search: " x'; drop ", status: 'paid' });
    expect(q.where).toBe('WHERE (s.shipment_number ILIKE $1 OR o.order_number ILIKE $1 OR co.name ILIKE $1) AND s.status::text = $2');
    expect(q.params).toEqual(["%x'; drop%", 'paid']);
  });

  it('rejects a status that is not a plain name, and a status on a list without one', () => {
    expect(() => backofficeQuery(BACKOFFICE_VIEWS.kyc, { status: "pending' OR 1=1" })).toThrow(BadRequestException);
    expect(() => backofficeQuery(BACKOFFICE_VIEWS.suppliers, { status: 'active' })).toThrow(BadRequestException);
  });

  it('masks phones, emails and people\'s names like josh\'s winback screens', () => {
    const row = maskRow(BACKOFFICE_VIEWS.admin_access, { email: 'somchai@jagota.com', first_name: 'สมชาย', last_name: 'ใจดี', mobile_phone: '0812345678', status: 'pending' });
    expect(row.email).not.toBe('somchai@jagota.com');
    expect(row.mobile_phone).not.toBe('0812345678');
    expect(row.last_name).not.toBe('ใจดี');
    expect(row.status).toBe('pending');
    const supplier = maskRow(BACKOFFICE_VIEWS.suppliers, { supplier_name: 'ACME', phone: '021234567', email: 'sales@acme.co' });
    expect(supplier.supplier_name).toBe('ACME');
    expect(supplier.phone).not.toBe('021234567');
  });

  it('every view has unique column keys and a default order', () => {
    for (const [key, v] of Object.entries(BACKOFFICE_VIEWS)) {
      const keys = v.columns.map((c) => c.key);
      expect({ key, unique: new Set(keys).size === keys.length }).toEqual({ key, unique: true });
      expect(v.order).toBeTruthy();
    }
  });
});
