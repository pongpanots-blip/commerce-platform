import { BadRequestException } from '@nestjs/common';
import { ProductPromotionRulesService } from './product-promotion-rules.service';

describe('signed promotion snapshot validation', () => {
  it.each([
    { sku: 123, version: '1' }, { sku: ' ', version: '1' },
    { sku: 'SKU', version: 9007199254740993 }, { sku: 'SKU', version: '9223372036854775808' },
    { sku: 'SKU', version: '1e3' }, { sku: 'SKU', version: '-1' },
  ])('rejects invalid SKU/version before storage (%p)', async ({ sku, version }) => {
    const transaction = jest.fn();
    const service = new ProductPromotionRulesService({ transaction } as never, { publish: jest.fn() });
    await expect(service.inbound({ type: 'promotion-rules.snapshot', aggregateId: 'id', version, data: { sku, rules: [] } } as never))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([null, 1, '-1', '2', '9223372036854775808'])('rejects invalid/future assignment reset markers (%p)', async (rules_reset_version) => {
    const transaction = jest.fn();
    const service = new ProductPromotionRulesService({ transaction } as never, { publish: jest.fn() });
    await expect(service.inbound({ type: 'promotion-lock.snapshot', aggregateId: 'id', version: '1', data: { sku: 'SKU', lock: null, rules_reset_version } } as never))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
