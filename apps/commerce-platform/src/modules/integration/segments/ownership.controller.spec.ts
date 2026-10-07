import { OwnershipController } from './ownership.controller';

describe('GET /api/ownership', () => {
  const OLD = process.env.COMMERCE_OWNS_SEGMENTS;
  afterEach(() => { process.env.COMMERCE_OWNS_SEGMENTS = OLD; });
  it('tells commerce-admin which josh features commerce owns now (only the literal "true")', () => {
    process.env.COMMERCE_OWNS_SEGMENTS = 'TRUE';
    expect(new OwnershipController().get()).toEqual({ segments: false });
    process.env.COMMERCE_OWNS_SEGMENTS = 'true';
    expect(new OwnershipController().get()).toEqual({ segments: true });
  });
});
