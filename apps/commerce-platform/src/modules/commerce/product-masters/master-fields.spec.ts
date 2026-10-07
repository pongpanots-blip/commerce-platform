import { BadRequestException } from '@nestjs/common';
import { buildMasterPatch, JOSH_MASTER_SQL, MASTER_KEYS, splitMaster } from './master-fields';

describe('master fields (stage 4d) — josh buildProductUpsertPendingPatch, master keys only', () => {
  it('maps an ERP product upsert the way josh stages it (no price / MOQ / names)', () => {
    expect(buildMasterPatch({
      PRODUCT_CODE: 'P-1', PRODUCT_NAME_E: 'Pork', PRICE: 120, SELLING_UNIT_PRICE: 12, MOQ: 3,
      ORDER_TAKING: 'Y', SUP_CODE: ' 316 ', SELLING_UNIT: 'KG', ORDER_TAKING_UNIT: 'BX', ORDERING_OPTIONS: [{ UNIT_CODE: 'bx ' }, 'kg', 'KG'],
      PACK_SIZE: ' 5 KG X 1 BG ', PACKAGE_TYPE: 'fixed', UNIT_PER_BOX: 6, WEIGHT_PER_UNIT: '5', BRAND_NAME: 'CSM', VAT: '1',
      MARKETED_BY: '  ', PRODUCT_TYPE: 'stock', SEASON_START: '2026-11-01', STATUS: 'N', IS_ENABLE: '0', GROUP_CODE: '1-2-1',
    })).toEqual({
      order_taking_flag: 'Y', sup_code: '316', selling_unit: 'KG', order_taking_unit: 'BX', erp_ordering_units: ['BX', 'KG'],
      pack_size: '5 KG X 1 BG', packaging_type: 'fixed', units_per_box: '6', weight_per_unit: '5', brand_name: 'CSM', vat_type: '7%',
      marketed_by: null, product_type: 'stock', season_start: '2026-11-01', product_status: 'inactive', category_code: '1-2-1',
    });
    expect(buildMasterPatch({ PRODUCT_CODE: 'P-1', PACK_SIZE: '', VAT: '0', PRODUCT_STATUS: 'Z' })).toEqual({ pack_size: null, vat_type: '0%', product_status: 'inactive' });
    expect(buildMasterPatch({ PRODUCT_CODE: 'P-1', STATUS: 'ACTIVE', IS_ENABLE: '1' })).toEqual({ product_status: 'active' });
  });

  it('splits the product form: master keys validated, category by id, the rest left for josh', () => {
    expect(splitMaster({ product_status: 'active', category_id: '', brand_name: ' B ', low_stock_threshold: 3 }))
      .toEqual({ master: { product_status: 'active', brand_name: 'B' }, categoryId: null, rest: { low_stock_threshold: 3 } });
    expect(() => splitMaster({ vat_type: '10%' })).toThrow(BadRequestException);
    expect(() => splitMaster({ order_taking_flag: 'yes' })).toThrow(BadRequestException);
  });

  it('josh SQL builds every master key and leaves drafts out', () => {
    for (const k of MASTER_KEYS) expect(JOSH_MASTER_SQL).toContain(`'${k}'`);
    expect(JOSH_MASTER_SQL).toContain(`IS DISTINCT FROM 'draft'`);
  });
});
