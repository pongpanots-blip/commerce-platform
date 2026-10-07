import { describeOurOffer } from './competitor-prices.service';

const sku = (fields: Record<string, unknown>) => fields as never;

it('describes Approx per-kg SKUs ordered by carton as a weight and price range', () => {
  const offer = describeOurOffer(sku({ packaging_type: 'Approx', selling_unit: 'KG', order_taking_unit: 'CT', selling_unit_price: 750, pack_size: '0.60 - 2.5 KG X 9 PC' }));
  expect(offer).toMatchObject({ pricingType: 'approx', packWeightKg: { min: 5.4, max: 22.5 }, pricePerKgIncVat: { min: 750, max: 750 }, orderUnitPriceIncVat: { min: 4050, max: 16875 } });
  expect(offer.summary).toBe('ขายต่อกิโลกรัม สั่งเป็นลัง · 1 ลัง ≈ 5.4–22.5 กก. (น้ำหนักไม่คงที่) · ฿750/กก. · ประมาณ ฿4,050–฿16,875 ต่อลัง');
});

it('describes a fixed pack with one weight and one price', () => {
  const offer = describeOurOffer(sku({ packaging_type: 'Fixed', selling_unit: 'PK', selling_unit_price: 120, weight_per_unit: '1.00 KG' }));
  expect(offer.summary).toBe('ขายเป็นแพ็ค · 1 แพ็ค 1 กก. · ฿120/กก. · ฿120 ต่อแพ็ค');
});

it('gives a per-kg range for a carton price over a carton weight range (heaviest = cheapest per kg)', () => {
  const offer = describeOurOffer(sku({ packaging_type: 'Approx', selling_unit: 'BX', selling_unit_price: 3000, pack_size: '15 - 20 KG X 1 BX' }));
  expect(offer.pricePerKgIncVat).toEqual({ min: 150, max: 200 });
  expect(offer.summary).toBe('ขายเป็นกล่อง · 1 กล่อง ≈ 15–20 กก. (น้ำหนักไม่คงที่) · ฿150–฿200/กก. · ฿3,000 ต่อกล่อง');
});

it('says when an item has no weight to compare per kg', () => {
  const offer = describeOurOffer(sku({ packaging_type: 'Fixed', selling_unit: 'CT', selling_unit_price: 480, pack_size: '330 ML X 24 CN' }));
  expect(offer.pricePerKgIncVat).toBeNull();
  expect(offer.summary).toBe('ขายเป็นลัง · ขนาด 330 ML X 24 CN · ฿480 ต่อลัง');
});

it('says when the catalogue has no price yet', () => {
  expect(describeOurOffer(sku({ packaging_type: 'Approx', selling_unit: 'PC', selling_unit_price: 0, pack_size: '0.10 - 0.13 KG X 1 PC' })).summary)
    .toBe('ขายเป็นชิ้น · 1 ชิ้น ≈ 0.1–0.13 กก. (น้ำหนักไม่คงที่) · ยังไม่มีราคาในแค็ตตาล็อก');
});
