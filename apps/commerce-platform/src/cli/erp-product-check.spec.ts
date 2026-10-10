import { verdictOf } from './erp-product-check';

describe('erp product check verdict', () => {
  it('reads IS_ENABLE and STATUS the way the ERP builds visibility', () => {
    expect(verdictOf(undefined)).toBe('not_found');
    expect(verdictOf({ PRODUCT_CODE: 'A', STATUS: 'N', IS_ENABLE: '1' })).toBe('enabled');
    expect(verdictOf({ PRODUCT_CODE: 'B', STATUS: 'N', IS_ENABLE: '2' })).toBe('hidden');
    expect(verdictOf({ PRODUCT_CODE: 'C', STATUS: 'Z', IS_ENABLE: '2' })).toBe('inactive');
  });
});
