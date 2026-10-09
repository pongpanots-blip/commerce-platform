import { z } from 'zod';

export const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const instant = z.iso.datetime({ offset: true });
export const EVENT_NAMES = ['branch_selected', 'checkout_started', 'order_accepted'] as const;
export type FoundationEventName = typeof EVENT_NAMES[number];

/** Contract only: no producer, collector, destination or consent grant is registered. */
export const foundationEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.uuid(),
  name: z.enum(EVENT_NAMES),
  occurredAt: instant,
  receivedAt: instant,
  source: z.enum(['synthetic_fixture', 'shop_server', 'commerce_server', 'shop_browser']),
  environment: z.enum(['synthetic', 'development', 'production']),
  context: z.object({
    tenantId: opaqueId,
    companyId: opaqueId.nullable(),
    branchId: opaqueId.nullable(),
    subjectUserId: opaqueId.nullable(),
    actorKind: z.enum(['customer', 'staff', 'system', 'anonymous']),
    actorUserId: opaqueId.nullable(),
    cartId: opaqueId.nullable(),
    orderId: opaqueId.nullable(),
  }).strict(),
  consent: z.object({ analytics: z.enum(['granted', 'denied', 'unknown']), policyVersion: opaqueId.nullable() }).strict(),
  acceptanceBasis: z.enum(['committed_confirmation', 'synthetic_confirmation']).nullable(),
}).strict().superRefine((e, ctx) => {
  if (Date.parse(e.receivedAt) < Date.parse(e.occurredAt)) ctx.addIssue({ code: 'custom', message: 'Receipt precedes occurrence; quarantine clock inconsistency.' });
  if ((e.environment === 'synthetic') !== (e.source === 'synthetic_fixture')) ctx.addIssue({ code: 'custom', message: 'Synthetic source and environment must agree.' });
  if (e.name === 'order_accepted') {
    if (!e.context.orderId || !['commerce_server', 'synthetic_fixture'].includes(e.source)) ctx.addIssue({ code: 'custom', message: 'Accepted orders require canonical order identity and a committed server confirmation.' });
    if (e.acceptanceBasis !== (e.source === 'synthetic_fixture' ? 'synthetic_confirmation' : 'committed_confirmation')) ctx.addIssue({ code: 'custom', message: 'Acceptance evidence is required.' });
  } else if (e.acceptanceBasis !== null) ctx.addIssue({ code: 'custom', message: 'A checkout or branch selection is not an accepted order.' });
});
export type FoundationEvent = z.infer<typeof foundationEventSchema>;

export function parseFoundationEvent(raw: unknown): FoundationEvent {
  const e = foundationEventSchema.parse(raw);
  return { ...e, occurredAt: new Date(e.occurredAt).toISOString(), receivedAt: new Date(e.receivedAt).toISOString() };
}

/** Never rewrite past context after login, logout, branch changes or assisted ordering. */
export function deduplicateFixtureEvents(raw: unknown[]): FoundationEvent[] {
  const events = new Map<string, FoundationEvent>();
  const orders = new Map<string, string>();
  for (const input of raw) {
    const e = parseFoundationEvent(input);
    if (e.environment !== 'synthetic') throw new Error('Fixture data must be synthetic.');
    const key = `${e.context.tenantId}:${e.eventId}`;
    const prior = events.get(key);
    const immutable = (v: FoundationEvent) => JSON.stringify({ ...v, receivedAt: undefined });
    if (prior && immutable(prior) !== immutable(e)) throw new Error('Conflicting event ID; immutable occurrence context required.');
    if (e.name === 'order_accepted') {
      const orderKey = `${e.context.tenantId}:${e.context.orderId}`;
      const context = JSON.stringify([e.context, e.occurredAt, e.source, e.acceptanceBasis]);
      const first = orders.get(orderKey);
      if (first && first !== context) throw new Error('Conflicting accepted-order identity/time; reconcile before evaluation.');
      orders.set(orderKey, context);
    }
    events.set(key, prior && Date.parse(prior.receivedAt) <= Date.parse(e.receivedAt) ? prior : e);
  }
  return [...events.values()];
}
