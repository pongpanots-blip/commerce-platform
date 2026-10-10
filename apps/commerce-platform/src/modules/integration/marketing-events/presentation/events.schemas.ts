import type { EventRule } from '@cp/marketing-workflow';
import { z } from 'zod';
import { DEVICE_ID } from '../domain/event-catalog';

const opaque = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
/** Public ingest (spec §3). source / environment / receivedAt are not accepted from clients (strict). */
export const ingestSchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().regex(DEVICE_ID),
  platform: z.enum(['web', 'ios', 'android']),
  pushSubscriptionId: z.string().uuid().optional(),
  events: z.array(z.object({
    eventId: z.string().uuid(),
    name: z.string().min(1).max(64),
    occurredAt: z.string().datetime({ offset: true }),
    context: z.object({ companyId: opaque.optional(), branchId: opaque.optional(), actorKind: z.enum(['customer', 'staff', 'anonymous']).optional() }).strict().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  }).strict()).min(1).max(20),
}).strict();
export type IngestBody = z.infer<typeof ingestSchema>;


const key = z.string().min(1).max(40);
export const eventFilterSchema = z.object({
  key, op: z.enum(['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'before', 'after', 'within_last_days', 'within_next_days']),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(500)).max(50), z.object({ fromTrigger: key }).strict()]),
}).strict();
const leafSchema = z.union([
  z.object({ kind: z.literal('event'), name: z.string().max(64), measure: z.union([z.literal('count'), z.object({ sum: key }).strict()]),
    op: z.enum(['gte', 'eq', 'lte']), value: z.number(),
    window: z.union([z.object({ lastDays: z.number().int() }).strict(), z.object({ from: z.string().max(40), to: z.string().max(40) }).strict()]),
    filters: z.array(eventFilterSchema).max(10) }).strict(),
  z.object({ kind: z.literal('segment'), segmentId: z.string().uuid() }).strict(),
]);
export const eventRuleSchema: z.ZodType<EventRule> = z.lazy(() => z.union([
  z.object({ op: z.enum(['AND', 'OR']), children: z.array(eventRuleSchema).max(16) }).strict(), leafSchema,
])) as z.ZodType<EventRule>;
export const definitionSchema = z.object({
  name: z.string().max(64), label: z.string().max(120), description: z.string().max(2000).nullable(), evidence: z.enum(['browser', 'server']),
  attributes: z.array(z.object({ key, type: z.enum(['string', 'number', 'boolean', 'date']), label: z.string().max(120), archived: z.boolean().optional() }).strict()).max(20),
}).strict();
export const dynamicSegmentSchema = z.object({ name: z.string().min(1).max(155), description: z.string().max(2000).nullable(), rule: eventRuleSchema }).strict();
export const previewSchema = z.object({ rule: eventRuleSchema }).strict();
export const eventListSchema = z.object({
  deviceId: z.string().regex(DEVICE_ID).optional(), userId: z.string().uuid().optional(), name: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const dailySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
