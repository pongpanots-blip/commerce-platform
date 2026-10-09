import { localizeRuleUnitLabels, localizeUnitLabel, unitLabelForStorage } from './unit-label.helper';

describe('localizeUnitLabel', () => {
  it('maps ERP codes per lang', () => {
    expect(localizeUnitLabel('KG', 'th')).toBe('กิโลกรัม');
    expect(localizeUnitLabel('kg', 'en')).toBe('kg');
    expect(localizeUnitLabel('BX', 'en')).toBe('box');
    expect(localizeUnitLabel('GM', 'th')).toBe('กรัม');
    expect(localizeUnitLabel('CS', 'en')).toBe('carton');
    // CA is a can, not a case
    expect(localizeUnitLabel('CA', 'en')).toBe('can');
    expect(localizeUnitLabel('CA', 'th')).toBe('กระป๋อง');
    expect(unitLabelForStorage('can')).toBe('CA');
  });

  it('covers every unit code the catalog uses (BT bottle etc.)', () => {
    expect(localizeUnitLabel('BT', 'th')).toBe('ขวด');
    expect(localizeUnitLabel('BT', 'en')).toBe('bottle');
    expect(localizeUnitLabel('TY', 'en')).toBe('tray');
    for (const code of ['BT', 'BK', 'DR', 'DZ', 'GL', 'PA', 'ST', 'TI', 'TR', 'TY', 'TU', 'UN']) {
      expect(localizeUnitLabel(code, 'en')).not.toBe(code);
      expect(localizeUnitLabel(code, 'th')).not.toBe(code);
    }
  });

  it('translates Thai words admins stored in unit_label', () => {
    expect(localizeUnitLabel('ชิ้น', 'en')).toBe('pc');
    expect(localizeUnitLabel('โล', 'en')).toBe('kg');
    expect(localizeUnitLabel('โล', 'th')).toBe('กิโลกรัม');
    // a typed ขวด is a bottle (BT); the jar (JR) has its own Thai word
    expect(localizeUnitLabel('ขวด', 'en')).toBe('bottle');
    expect(localizeUnitLabel('ขวดโหล', 'en')).toBe('jar');
    expect(localizeUnitLabel('JR', 'th')).toBe('ขวดโหล');
  });

  it('keeps unknown custom labels and empty as null', () => {
    expect(localizeUnitLabel('ถาด', 'en')).toBe('ถาด');
    expect(localizeUnitLabel('  ', 'th')).toBeNull();
    expect(localizeUnitLabel(null, 'th')).toBeNull();
  });

  it('localizes promotion rules without touching prices', () => {
    expect(
      localizeRuleUnitLabels(
        [{ min_qty: 1, promotion_price: 350, unit_label: 'KG' }, { min_qty: 5, promotion_price: 300 }],
        'en',
      ),
    ).toEqual([
      { min_qty: 1, promotion_price: 350, unit_label: 'kg' },
      { min_qty: 5, promotion_price: 300 },
    ]);
  });
});

describe('English display words saved back by an admin form', () => {
  it('read side: a persisted "box" localizes like the code', () => {
    expect(localizeUnitLabel('box', 'th')).toBe('กล่อง');
    expect(localizeUnitLabel('Carton', 'th')).toBe('ลัง');
    expect(localizeUnitLabel('box', 'en')).toBe('box');
  });

  it('write side: English words become the code; everything else is untouched', () => {
    expect(unitLabelForStorage('box')).toBe('BX');
    expect(unitLabelForStorage(' Pack ')).toBe('PK');
    expect(unitLabelForStorage('กล่อง')).toBe('กล่อง');
    expect(unitLabelForStorage('BX')).toBe('BX');
    expect(unitLabelForStorage('Bottle')).toBe('BT');
    expect(unitLabelForStorage('ถาด')).toBe('ถาด');
    expect(unitLabelForStorage(undefined)).toBeUndefined();
  });
});
