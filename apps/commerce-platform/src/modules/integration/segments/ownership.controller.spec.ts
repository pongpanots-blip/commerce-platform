import { OwnershipController } from './ownership.controller';

describe('GET /api/ownership', () => {
  const OLD = { segments: process.env.COMMERCE_OWNS_SEGMENTS, salesReps: process.env.COMMERCE_OWNS_SALES_REPS };
  afterEach(() => { process.env.COMMERCE_OWNS_SEGMENTS = OLD.segments; process.env.COMMERCE_OWNS_SALES_REPS = OLD.salesReps; });
  it('tells commerce-admin which josh features commerce owns now (only the literal "true")', () => {
    process.env.COMMERCE_OWNS_SEGMENTS = 'TRUE';
    process.env.COMMERCE_OWNS_SALES_REPS = 'false';
    expect(new OwnershipController().get()).toEqual({ segments: false, salesReps: false, prices: false, productContent: false, categories: false });
    process.env.COMMERCE_OWNS_SEGMENTS = 'true';
    process.env.COMMERCE_OWNS_SALES_REPS = 'true';
    expect(new OwnershipController().get()).toEqual({ segments: true, salesReps: true, prices: false, productContent: false, categories: false });
  });
});
