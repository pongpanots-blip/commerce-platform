import { parseWeightRange, weightFieldsFor } from './weight-range.helper';

describe('parseWeightRange', () => {
  it('parses a min-max range', () => {
    expect(parseWeightRange('5.5 - 6.5 KG')).toEqual({
      min: 5.5,
      max: 6.5,
      unit: 'KG',
    });
  });

  it('parses a min-max range with no spaces around the dash/unit', () => {
    expect(parseWeightRange('5.5-6.5KG')).toEqual({
      min: 5.5,
      max: 6.5,
      unit: 'KG',
    });
  });

  it('parses a unit-less value as min-only with a null unit', () => {
    expect(parseWeightRange('6.50')).toEqual({
      min: 6.5,
      max: null,
      unit: null,
    });
  });

  it('keeps the leading weight and drops an X-suffix with a different pack unit', () => {
    expect(parseWeightRange('1 KG X 2 PK')).toEqual({
      min: 1,
      max: null,
      unit: 'KG',
    });
  });

  it('parses a bare count + unit like a weight (packaging_type gating happens in the caller)', () => {
    expect(parseWeightRange('10 PC')).toEqual({
      min: 10,
      max: null,
      unit: 'PC',
    });
  });

  it('strips a standalone X/x pack-count suffix before parsing', () => {
    expect(parseWeightRange('7 - 8.5 KG X 1 PC')).toEqual({
      min: 7,
      max: 8.5,
      unit: 'KG',
    });
    expect(parseWeightRange('7 - 8.5 KG x 1 PC')).toEqual({
      min: 7,
      max: 8.5,
      unit: 'KG',
    });
  });

  it('parses a single value with no range as min-only', () => {
    expect(parseWeightRange('6.50 KG')).toEqual({
      min: 6.5,
      max: null,
      unit: 'KG',
    });
    expect(parseWeightRange('0.4 KG')).toEqual({
      min: 0.4,
      max: null,
      unit: 'KG',
    });
  });

  it('returns null for unit-only, empty, null, or unparseable input', () => {
    expect(parseWeightRange('KG')).toBeNull();
    expect(parseWeightRange('')).toBeNull();
    expect(parseWeightRange(null)).toBeNull();
    expect(parseWeightRange(undefined)).toBeNull();
    expect(parseWeightRange('not a weight')).toBeNull();
  });
});

describe('weightFieldsFor', () => {
  it('parses the source string when packaging_type is Approx', () => {
    expect(weightFieldsFor('Approx', '5.5 - 6.5 KG')).toEqual({
      min: 5.5,
      max: 6.5,
      unit: 'KG',
    });
  });

  it('returns null for Fixed packaging even when the string looks parseable', () => {
    expect(weightFieldsFor('Fixed', '48 PC X 1 BX')).toBeNull();
  });

  it('tolerates ERP casing/whitespace drift on Approx', () => {
    expect(weightFieldsFor('approx', '5.5 - 6.5 KG')).toEqual({
      min: 5.5,
      max: 6.5,
      unit: 'KG',
    });
    expect(weightFieldsFor(' Approx ', '5.5 - 6.5 KG')).not.toBeNull();
  });

  it('returns null for missing/other packaging_type', () => {
    expect(weightFieldsFor(null, '5.5 - 6.5 KG')).toBeNull();
    expect(weightFieldsFor(undefined, '5.5 - 6.5 KG')).toBeNull();
    expect(weightFieldsFor('Other', '5.5 - 6.5 KG')).toBeNull();
  });
});
