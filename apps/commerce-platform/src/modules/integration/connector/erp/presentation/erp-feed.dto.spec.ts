import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductMoqItemDto, ProductPriceItemDto, ProductQtyItemDto } from './erp-feed.dto';

/**
 * The ERP contract lives in two repos with no shared type. These tests pin the
 * exact UPPER_SNAKE field names so a rename on this side fails loudly
 * (docs/erp-integration-tasks.md §3.4).
 */
describe('ERP feed DTO field names', () => {
  it('qty accepts the exact ERP shape and maps QUANTITY null → 0', async () => {
    const dto = plainToInstance(ProductQtyItemDto, {
      PRODUCT_CODE: '1001876', QUANTITY: null, CHANGED_AT: '2026-10-03T07:01:29Z', REASON: 'SALE',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.QUANTITY).toBe(0);
  });

  it('qty rejects camelCase', async () => {
    const dto = plainToInstance(ProductQtyItemDto, { productCode: 'x', quantity: 1 });
    const props = (await validate(dto)).map((e) => e.property).sort();
    expect(props).toEqual(['PRODUCT_CODE', 'QUANTITY']);
  });

  it('price nests ORDERING_PRICE / SELLING_UNIT_PRICE under PRICE', async () => {
    const dto = plainToInstance(ProductPriceItemDto, {
      PRODUCT_CODE: '1003120', PRICE: { ORDERING_PRICE: 590, SELLING_UNIT_PRICE: 59 },
    });
    expect(await validate(dto)).toEqual([]);
    const bad = plainToInstance(ProductPriceItemDto, { PRODUCT_CODE: '1', PRICE: { ORDERING_PRICE: '590' } });
    expect((await validate(bad)).map((e) => e.property)).toEqual(['PRICE']);
  });

  it('moq requires PRODUCT_CODE + MOQ', async () => {
    expect(await validate(plainToInstance(ProductMoqItemDto, { PRODUCT_CODE: '1', MOQ: 6 }))).toEqual([]);
    expect((await validate(plainToInstance(ProductMoqItemDto, { PRODUCT_CODE: '1' }))).map((e) => e.property)).toEqual(['MOQ']);
  });
});
