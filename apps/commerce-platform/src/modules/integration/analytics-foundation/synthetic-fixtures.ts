import { z } from 'zod';
import { deduplicateFixtureEvents, EVENT_NAMES, FoundationEvent, instant, opaqueId } from './event-contracts';

export const FIXTURE_EVALUATED_AT = '2026-10-09T00:00:00.000Z';
export const fixtureBranchSchema = z.object({ tenantId: opaqueId, companyId: opaqueId, branchId: opaqueId, createdAt: instant.nullable(), approvedAt: instant.nullable(), eligible: z.boolean().nullable(), region: z.string().max(80).nullable(), profileAsOf: instant.nullable() }).strict();
export const fixtureCoverageSchema = z.object({ tenantId: opaqueId, branchId: opaqueId, event: z.enum(EVENT_NAMES), completeFrom: instant, completeThrough: instant, assertedAt: instant, identityComplete: z.boolean() }).strict().superRefine((v, ctx) => {
  if (Date.parse(v.completeFrom) > Date.parse(v.completeThrough) || Date.parse(v.completeThrough) > Date.parse(v.assertedAt)) ctx.addIssue({ code: 'custom', message: 'Coverage cannot be inverted or assert future completeness.' });
});
export type FixtureBranch = z.infer<typeof fixtureBranchSchema>;
export type FixtureCoverage = z.infer<typeof fixtureCoverageSchema>;
export interface FixtureDataset { schemaVersion: 1; datasetVersion: 1; branches: FixtureBranch[]; events: FoundationEvent[]; coverage: FixtureCoverage[] }
const ago = (days: number) => new Date(Date.parse(FIXTURE_EVALUATED_AT) - days * 86400000).toISOString();
export function fixtureEvent(index: number, branchId: string | null, daysAgo: number, overrides: Partial<FoundationEvent> = {}): FoundationEvent {
  return { schemaVersion: 1, eventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: 'order_accepted', occurredAt: ago(daysAgo), receivedAt: ago(daysAgo),
    source: 'synthetic_fixture', environment: 'synthetic', context: { tenantId: 'tenant_a', companyId: 'company_a', branchId, subjectUserId: 'customer_one', actorKind: 'customer', actorUserId: 'customer_one', cartId: `cart_${index}`, orderId: `order_${index}` },
    consent: { analytics: 'unknown', policyVersion: null }, acceptanceBasis: 'synthetic_confirmation', ...overrides };
}
export function syntheticDataset(): FixtureDataset {
  const ids = ['first_order_waiting', 'repeat_inactive', 'recent_buyer', 'incomplete_history', 'unknown_approval', 'ineligible', 'late_arrival', 'old_birth'];
  const branches: FixtureBranch[] = ids.map(branchId => ({ tenantId: 'tenant_a', companyId: 'company_a', branchId, createdAt: ago(branchId === 'old_birth' ? 366 : 120), approvedAt: branchId === 'unknown_approval' ? null : ago(7), eligible: branchId !== 'ineligible', region: 'bangkok', profileAsOf: FIXTURE_EVALUATED_AT }));
  branches.push({ ...branches[1], tenantId: 'tenant_b', companyId: 'company_b' });
  const multiUser = fixtureEvent(2, 'repeat_inactive', 30); multiUser.context = { ...multiUser.context, subjectUserId: 'customer_two', actorUserId: 'staff_one', actorKind: 'staff' };
  const events = [fixtureEvent(1, 'repeat_inactive', 90), multiUser, fixtureEvent(3, 'repeat_inactive', 20), fixtureEvent(4, 'recent_buyer', 90), fixtureEvent(5, 'recent_buyer', 30), fixtureEvent(6, 'recent_buyer', 14),
    fixtureEvent(7, 'first_order_waiting', 1, { name: 'checkout_started', acceptanceBasis: null }), fixtureEvent(8, 'late_arrival', 20, { receivedAt: ago(-1) })];
  // Same customer can use another branch; branch membership never joins on user/device identity.
  for (let i = 10; i < 15; i++) { const e = fixtureEvent(i, 'repeat_inactive', 10); e.context = { ...e.context, tenantId: 'tenant_b', companyId: 'company_b' }; events.push(e); }
  const coverage = branches.flatMap(b => EVENT_NAMES.map(event => ({ tenantId: b.tenantId, branchId: b.branchId, event, completeFrom: ago(365), completeThrough: b.branchId === 'incomplete_history' ? ago(1) : FIXTURE_EVALUATED_AT, assertedAt: FIXTURE_EVALUATED_AT, identityComplete: true })));
  return validateFixtureDataset({ schemaVersion: 1, datasetVersion: 1, branches, events, coverage });
}
export function validateFixtureDataset(raw: unknown): FixtureDataset {
  const v = z.object({ schemaVersion: z.literal(1), datasetVersion: z.literal(1), branches: z.array(fixtureBranchSchema).max(200), events: z.array(z.unknown()).max(1000), coverage: z.array(fixtureCoverageSchema).max(600) }).strict().parse(raw);
  const branches = new Map(v.branches.map(b => [`${b.tenantId}:${b.branchId}`, b]));
  if (branches.size !== v.branches.length) throw new Error('Duplicate fixture branch identity.');
  const events = deduplicateFixtureEvents(v.events);
  for (const e of events) {
    const b = e.context.branchId === null ? undefined : branches.get(`${e.context.tenantId}:${e.context.branchId}`);
    if (b && e.context.companyId !== null && b.companyId !== e.context.companyId) throw new Error('Event branch/company identity conflict.');
    if (b?.createdAt && Date.parse(e.occurredAt) < Date.parse(b.createdAt)) throw new Error('Event precedes branch birth.');
    if (e.context.branchId !== null && !b) throw new Error('Unresolved fixture branch ID must be represented as null.');
  }
  const keys = v.coverage.map(c => `${c.tenantId}:${c.branchId}:${c.event}`);
  if (new Set(keys).size !== keys.length || v.coverage.some(c => !branches.has(`${c.tenantId}:${c.branchId}`))) throw new Error('Invalid fixture coverage identity.');
  return { ...v, events };
}

export const FIXTURE_GRANTS: ReadonlyMap<string, { tenantId: string; branchIds: readonly string[] }> = new Map([
  ['analyst_a', { tenantId: 'tenant_a', branchIds: ['first_order_waiting', 'repeat_inactive', 'recent_buyer', 'incomplete_history', 'unknown_approval', 'ineligible', 'late_arrival', 'old_birth'] }],
  ['analyst_b', { tenantId: 'tenant_b', branchIds: ['repeat_inactive'] }],
]);
