import { partitionCheckoutTypes } from './checkout.helpers';

describe('partitionCheckoutTypes', () => {
  it('reuses store_visit as primary and keeps call/line as extras', () => {
    expect(partitionCheckoutTypes(['call', 'store_visit', 'line'], 'store_visit')).toEqual({
      primaryType: 'store_visit',
      extraTypes: ['call', 'line'],
    });
  });

  it('repurposes the row as the first selected type when no visit type is selected, even if the open type is a visit', () => {
    expect(partitionCheckoutTypes(['call', 'line'], 'visit')).toEqual({
      primaryType: 'call',
      extraTypes: ['line'],
    });
  });

  it('does not double-count a phantom store_visit when only a non-visit type is selected at checkout', () => {
    expect(partitionCheckoutTypes(['call'], 'store_visit')).toEqual({
      primaryType: 'call',
      extraTypes: [],
    });
  });

  it('picks the first selected type as primary when neither open nor selected types are a visit', () => {
    expect(partitionCheckoutTypes(['call', 'line'], 'call')).toEqual({
      primaryType: 'call',
      extraTypes: ['line'],
    });
  });

  it('dedupes repeated types before partitioning', () => {
    expect(partitionCheckoutTypes(['call', 'call', 'line'], 'call')).toEqual({
      primaryType: 'call',
      extraTypes: ['line'],
    });
  });

  it('returns only a primary type when a single type is selected', () => {
    expect(partitionCheckoutTypes(['call'], 'call')).toEqual({
      primaryType: 'call',
      extraTypes: [],
    });
  });
});
