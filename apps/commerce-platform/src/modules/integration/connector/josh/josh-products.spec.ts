import { BadRequestException } from '@nestjs/common';
import { JoshProducts, PRODUCT_ISSUES, productWhere } from './josh-products';

describe('josh products (read-only catalog)', () => {
  it('binds typed values as parameters and maps issues to fixed SQL', () => {
    const { where, params } = productWhere({ search: "x'; drop", issue: 'no_image', brand: 'Josh', orderTaking: 'Y' });
    expect(where).not.toContain('drop');
    expect(params).toEqual(["%x'; drop%", '%Josh%', 'Y']);
    expect(where).toContain(PRODUCT_ISSUES.no_image);
    expect(productWhere({})).toEqual({ where: '', params: [] });
  });

  it('rejects unknown issues and non-uuid categories', () => {
    expect(() => productWhere({ issue: '1=1' })).toThrow(BadRequestException);
    expect(() => productWhere({ categoryId: 'x' })).toThrow(BadRequestException);
  });

  it('shows each pending ERP field next to the live value', async () => {
    const replica = { query: jest.fn()
      .mockResolvedValueOnce([{ product_inventory_id: 'p1', selling_unit_price: 250, name_th: 'แซลมอน',
        erp_pending_payload: { SELLING_UNIT_PRICE: 275, PRODUCT_NAME_T: 'แซลมอน', SOMETHING_NEW: 1 } }])
      .mockResolvedValueOnce([]) };
    const d = await new JoshProducts(replica as never).detail('1001876');
    expect(replica.query.mock.calls[0][0]).toContain('p.product_inventory_sku = $1');
    expect(d.pendingChanges).toEqual([
      { field: 'SELLING_UNIT_PRICE', column: 'selling_unit_price', current: 250, pending: 275, changed: true },
      { field: 'PRODUCT_NAME_T', column: 'name_th', current: 'แซลมอน', pending: 'แซลมอน', changed: false },
      { field: 'SOMETHING_NEW', column: null, current: null, pending: 1, changed: null },
    ]);
  });
});
