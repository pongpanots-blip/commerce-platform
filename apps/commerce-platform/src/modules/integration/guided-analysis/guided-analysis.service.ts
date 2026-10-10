import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { GUIDED_PREVIEWS, guidedDefinition } from '../analytics-foundation/guided-previews';
import type { FixtureSegmentPreview } from '../analytics-foundation/fixture-executor';
import type { StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';
import { fixtureGuidedPreview, missingContractIds, normalizeGuidedQuery, unavailableGuidedPreview, verifyGuidedCatalog } from './guided-analysis.contracts';

/** Test-only binding; GuidedAnalysisModule registers no fixture or live data source. */
export const GUIDED_ANALYSIS_FIXTURE_SOURCE = Symbol('GUIDED_ANALYSIS_FIXTURE_SOURCE');
export interface OwnedGuidedFixtureSource {
  purpose: 'owned_local_fixture';
  evaluate: (definition: ReturnType<typeof guidedDefinition>['definition'], staff: StaffRequest['staff']) => Promise<FixtureSegmentPreview>;
}
@Injectable()
export class GuidedAnalysisService {
  constructor(@Optional() @Inject(GUIDED_ANALYSIS_FIXTURE_SOURCE) private readonly fixture?: OwnedGuidedFixtureSource) {}
  catalog() {
    return verifyGuidedCatalog({ schemaVersion: 1, templates: GUIDED_PREVIEWS, mode: 'live_unavailable', missingContracts: [...missingContractIds], activationAllowed: false, liveIntegrationComplete: false, operationalWrites: false });
  }
  async preview(raw: unknown, staff: StaffRequest['staff']) {
    let query: ReturnType<typeof normalizeGuidedQuery>;
    try { query = normalizeGuidedQuery(raw); }
    catch { throw new BadRequestException('Choose a supported template and valid whole-number windows. Inactivity must fit inside the purchase window.'); }
    if (!this.fixture) return unavailableGuidedPreview(query);
    if (process.env.NODE_ENV !== 'test' || this.fixture.purpose !== 'owned_local_fixture') throw new ServiceUnavailableException('Live branch analysis source is not configured.');
    const { definition } = guidedDefinition({ template: query.template, inputs: Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'template')) });
    try { return fixtureGuidedPreview(query, await this.fixture.evaluate(definition, staff)); }
    catch { throw new ServiceUnavailableException('Synthetic analysis evidence unavailable. Retry the read after the owned fixture is ready.'); }
  }
}
