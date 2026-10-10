import { buildExtrasPatch } from './erp-extras';

describe('ERP product extras — spec 2026-10-09 (Aging, min prices, substitutes, FDA album)', () => {
  it('maps every field, sorts substitutes by SEQ, rounds money', () => {
    expect(buildExtrasPatch({
      PRODUCT_CODE: 'P-1', AGING_DAYS: 180, MIN_PRICE: 1100.004, MIN_SELLING_UNIT_PRICE: 110,
      SUBSTITUTES: [{ PRODUCT_CODE: ' P-3 ', SEQ: 2 }, { PRODUCT_CODE: 'P-2', SEQ: 1 }],
      FDA_IMAGES: [
        { URL: 'https://erp.example/fda/halal.pdf', DOC_TYPE: 'CERT', NAME: 'Halal 2026', EXPIRY_DATE: '2027-03-31' },
        { URL: 'https://erp.example/fda/label.jpg', DOC_TYPE: 'LABEL' },
      ],
    })).toEqual({
      invalid: [],
      patch: {
        aging_days: 180, min_price: 1100, min_selling_unit_price: 110,
        substitutes: [{ sku: 'P-2', seq: 1 }, { sku: 'P-3', seq: 2 }],
        fda_images: [
          { url: 'https://erp.example/fda/halal.pdf', doc_type: 'CERT', name: 'Halal 2026', expiry_date: '2027-03-31' },
          { url: 'https://erp.example/fda/label.jpg', doc_type: 'LABEL', name: null, expiry_date: null },
        ],
      },
    });
  });

  it('absent keeps, null clears (lists to [])', () => {
    expect(buildExtrasPatch({ PRODUCT_CODE: 'P-1', PRICE: 5 })).toEqual({ patch: {}, invalid: [] });
    expect(buildExtrasPatch({ PRODUCT_CODE: 'P-1', AGING_DAYS: null, MIN_PRICE: null, SUBSTITUTES: null, FDA_IMAGES: [] }).patch)
      .toEqual({ aging_days: null, min_price: null, substitutes: [], fda_images: [] });
  });

  it('a bad value skips only that field', () => {
    const { patch, invalid } = buildExtrasPatch({
      PRODUCT_CODE: 'P-1', AGING_DAYS: '180', MIN_PRICE: -1, MIN_SELLING_UNIT_PRICE: 9.5,
      SUBSTITUTES: [{ PRODUCT_CODE: 'P-1', SEQ: 1 }],
      FDA_IMAGES: [{ URL: 'http://erp.example/x.jpg', DOC_TYPE: 'CERT' }],
    });
    expect(patch).toEqual({ min_selling_unit_price: 9.5 });
    expect(invalid).toEqual(['AGING_DAYS', 'MIN_PRICE', 'SUBSTITUTES', 'FDA_IMAGES']);
    for (const bad of [
      { SUBSTITUTES: [{ PRODUCT_CODE: 'P-2', SEQ: 1 }, { PRODUCT_CODE: 'P-2', SEQ: 2 }] },
      { SUBSTITUTES: [{ PRODUCT_CODE: 'P-2', SEQ: 0 }] },
      { FDA_IMAGES: [{ URL: 'https://erp.example/x.jpg', DOC_TYPE: 'PHOTO' }] },
      { FDA_IMAGES: [{ URL: 'https://erp.example/x.jpg', DOC_TYPE: 'CERT', EXPIRY_DATE: '2027-02-30' }] },
      { FDA_IMAGES: 'https://erp.example/x.jpg' },
    ]) expect(buildExtrasPatch({ PRODUCT_CODE: 'P-1', ...bad }).invalid).toHaveLength(1);
  });
});
