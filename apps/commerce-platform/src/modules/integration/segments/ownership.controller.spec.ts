import { Reflector } from '@nestjs/core';
import { STAFF_ROLES_KEY } from '../../../shared-kernel/presentation/auth.decorators';
import { OwnershipController } from './ownership.controller';

describe('GET /api/ownership', () => {
  const OLD = { segments: process.env.COMMERCE_OWNS_SEGMENTS, salesReps: process.env.COMMERCE_OWNS_SALES_REPS };
  afterEach(() => { process.env.COMMERCE_OWNS_SEGMENTS = OLD.segments; process.env.COMMERCE_OWNS_SALES_REPS = OLD.salesReps; });
  it('tells commerce-admin which josh features commerce owns now (only the literal "true")', () => {
    process.env.COMMERCE_OWNS_SEGMENTS = 'TRUE';
    process.env.COMMERCE_OWNS_SALES_REPS = 'false';
    expect(new OwnershipController().get()).toEqual({ segments: false, salesReps: false, prices: false, productContent: false, categories: false, productMaster: false, productImages: false, promotions: false, ordering: false, staff: false });
    process.env.COMMERCE_OWNS_SEGMENTS = 'true';
    process.env.COMMERCE_OWNS_SALES_REPS = 'true';
    expect(new OwnershipController().get()).toEqual({ segments: true, salesReps: true, prices: false, productContent: false, categories: false, productMaster: false, productImages: false, promotions: false, ordering: false, staff: false });
  });
  it('every staff role may read it (the pages of marketing / MER / CS pick their write route from it)', () => {
    expect(new Reflector().get(STAFF_ROLES_KEY, OwnershipController)).toEqual(['marketing', 'merchandising', 'cs']);
  });
});
