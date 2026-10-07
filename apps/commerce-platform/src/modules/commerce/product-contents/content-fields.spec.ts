import { BadRequestException } from '@nestjs/common';
import { CONTENT_FIELDS, JOSH_CONTENT_SQL, splitContent } from './content-fields';

describe('content fields (stage 4b)', () => {
  it('splits content from the rest of a product form and normalises values', () => {
    const { content, rest } = splitContent({
      product_name_th: '  ชื่อ  ', ingredients: '', buying_price: '12.35', low_stock_threshold: 5, product_short_code: 'AB',
      selling_unit: 'kg', category_id: null,
    });
    expect(content).toEqual({ product_name_th: 'ชื่อ', ingredients: null, buying_price: 12.35, low_stock_threshold: 5, product_short_code: 'AB' });
    expect(rest).toEqual({ selling_unit: 'kg', category_id: null });
  });

  it.each([
    [{ product_name_en: '' }], [{ product_name_th: 'x'.repeat(256) }], [{ buying_price: -1 }], [{ buying_price: 1.005 }],
    [{ low_stock_threshold: null }], [{ reorder_quantity: 1.5 }], [{ product_short_code: 'x'.repeat(21) }], [{ allergens: 5 }],
  ])('refuses %j', (body) => {
    expect(() => splitContent(body)).toThrow(BadRequestException);
  });

  it('josh SQL builds every content key', () => {
    for (const k of Object.keys(CONTENT_FIELDS)) expect(JOSH_CONTENT_SQL).toContain(`'${k}'`);
  });
});
