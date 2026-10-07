import { buildMatchIndex, comparableName, nameSimilarity, rankSiteCandidates, skuWeightMatch } from './competitor-prices.service';

it('scores competitor names against our SKUs by product words, not pack sizes', () => {
  expect(comparableName('สปอนเซอร์ เครื่องดื่มเกลือแร่ 250 มล. x 24')).toBe('สปอนเซอร์ เครื่องดื่มเกลือแร่');
  expect(comparableName('น่องติดสะโพกไก่ 1 กก.')).toBe('น่องติดสะโพกไก่');
  const makro = 'น่องติดสะโพกไก่ 1 กก.';
  const ranked = ['สะโพกไก่ติดน่อง แช่แข็ง 2 KG', 'อกไก่เนื้อล้วน 1 KG', 'แครอท 1 KG', 'Chicken Leg Quarter 1 KG']
    .map(name => [name, nameSimilarity(makro, name)] as const).sort((a, b) => b[1] - a[1]);
  expect(ranked[0][0]).toBe('สะโพกไก่ติดน่อง แช่แข็ง 2 KG');
  expect(nameSimilarity(makro, 'แครอท 1 KG')).toBeLessThan(0.2);
  // Same words with a different pack size is still the same product name.
  expect(nameSimilarity('แครอทนอก จีน 1 กก.', 'แครอทนอก จีน 5 กก.')).toBe(1);
});

it('classifies weight: per-kg SKUs, within 5%, different, unknown', () => {
  expect(skuWeightMatch('KG', null, 1)).toBe('per_kg');
  expect(skuWeightMatch('PC', 1, 1.04)).toBe('same');
  expect(skuWeightMatch('PC', 2, 1)).toBe('different');
  expect(skuWeightMatch('PC', null, 1)).toBe('unknown');
});

it('finds the same SKU on every site: top per site, junk and already-paired items skipped, with price/kg vs ours', () => {
  const item = (id: string, name: string, sourceId: string, weightKg: number | null = 1, priceIncVat: number | null = 100) =>
    ({ id, name, url: `https://${sourceId}/${id}`, weightKg, priceIncVat, image: null, rawPrice: null, sourceId, sourceName: sourceId });
  const index = buildMatchIndex([
    item('a', 'สะโพกไก่ติดน่อง 1 KG', 'makro'), item('b', 'แครอท 1 KG', 'makro'),
    item('c', 'น่องติดสะโพกไก่ 2 กก.', 'lotus', 2, 180), item('d', 'น่องติดสะโพกไก่ 1 กก.', 'lotus', 1, 90),
    item('e', 'น่องติดสะโพกไก่ 1 กก.', 'gourmet'),
    item('f', 'น่องติดสะโพกไก่', 'e2e', null), // no weight: kept, a person types the size
    item('g', 'น่องติดสะโพกไก่ 1 กก.', 'e2e', 1, null), // no price at all: dropped
  ]);
  expect(index.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  const sites = rankSiteCandidates(['น่องติดสะโพกไก่ 1 กก.'], 'PC', 1, 100, index, new Set(['https://gourmet/e']));
  expect(sites.map(site => site.sourceName)).toEqual(['e2e', 'lotus', 'makro']);
  expect(sites[0].candidates[0]).toMatchObject({ id: 'f', pricePerKgIncVat: null, verdict: 'ยังเทียบราคาต่อกก.ไม่ได้' });
  expect(sites[1].candidates.map(c => [c.id, c.pricePerKgIncVat, c.verdict])).toEqual([['d', 90, 'เราแพงกว่า 11.11%'], ['c', 90, 'เราแพงกว่า 11.11%']]); // same weight first
  expect(sites[2].candidates.map(c => c.id)).toEqual(['a']); // carrot is not close enough
  expect(rankSiteCandidates(['Josh Smoked Salmon'], 'PC', 1, 100, buildMatchIndex([item('x', 'We are Built to Maximize Restaurant Profit', 'e2e')]), new Set())).toEqual([]);
});
