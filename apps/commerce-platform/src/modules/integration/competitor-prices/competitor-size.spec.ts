import { compareAtOurPack, extractedVolumeL, itemPackSize, packQuantity, packSizeText, toPackSize } from './competitor-size';

it('converts typed sizes to kg / l / piece, ranges and multipacks', () => {
  expect(toPackSize({ unit: 'g', min: 800, max: 1200 })).toEqual({ unit: 'kg', min: 0.8, max: 1.2, packCount: 1 });
  const bottles = toPackSize({ unit: 'ml', min: 250, packCount: 24 });
  expect(bottles).toEqual({ unit: 'l', min: 0.25, max: 0.25, packCount: 24 });
  expect(packQuantity(bottles)).toBe(6);
  expect(packSizeText(bottles)).toBe('0.25 ลิตร × 24');
  expect(packSizeText(toPackSize({ unit: 'kg', min: 1.2, max: 0.8 }))).toBe('0.8–1.2 กก.');
  expect(extractedVolumeL('น้ำมันถั่วเหลือง 500 มล.')).toBe(0.5);
  expect(itemPackSize('น้ำมัน 1 ลิตร', null)).toEqual({ unit: 'l', min: 1, max: 1, packCount: 1 });
  expect(itemPackSize('ไก่ ชั่งน้ำหนัก', null)).toBeNull();
});

it('compares at our pack size in baht: small gaps read "พอๆ กัน", units must match', () => {
  const ours = { unit: 'kg' as const, qty: 1, rate: 99 };
  const twoKg = toPackSize({ unit: 'kg', min: 2 });
  expect(compareAtOurPack(ours, 192, twoKg)).toMatchObject({ verdict: 'พอๆ กัน (ต่าง ฿3)', tone: 'close', packLine: 'แพ็ก 2 กก. = ฿192',
    equivLine: 'ถ้าซื้อ 1 กก. เท่าเรา: เขา ฿96 · เรา ฿99' });
  expect(compareAtOurPack(ours, 59, toPackSize({ unit: 'g', min: 500 }))).toMatchObject({ verdict: 'เราถูกกว่า ฿19 (16.1%)', tone: 'cheaper' });
  expect(compareAtOurPack(ours, 80, toPackSize({ unit: 'kg', min: 1 }))).toMatchObject({ verdict: 'เราแพงกว่า ฿19 (23.75%)', tone: 'pricier' });
  expect(compareAtOurPack(ours, 100, toPackSize({ unit: 'piece', min: 1 })).verdict).toBe('หน่วยไม่ตรงกัน (เรา กก. / เขา ชิ้น)');
  expect(compareAtOurPack(ours, 100, null).verdict).toBe('ใส่ขนาดก่อนเทียบ');
  expect(compareAtOurPack({ ...ours, rate: null }, 100, twoKg).verdict).toBe('ราคาเราเป็นช่วง เทียบไม่ได้');
});
