import { z } from 'zod';
import { eventFilterSchema, eventRuleSchema } from '../../marketing-events/presentation/events.schemas';

/** Shape only (zod); the rules that block activation live in domain/workflow.validator.ts. */
const id = z.string().min(1).max(64);
const next = id.nullable();
const uuidList = z.array(z.string()).max(50).optional();
const header = z.object({ key: z.string().max(200), value: z.string().max(2000) }).strict();
const webhookStep = z.object({ id, type: z.literal('webhook'), method: z.enum(['POST', 'PUT', 'PATCH', 'GET']), url: z.string().max(2048),
  headers: z.array(header).max(50), body: z.string().max(64 * 1024).optional(), nextId: next }).strict();
export const stepSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('audience'), segmentIds: uuidList, excludeSegmentIds: uuidList, dynamicSegmentIds: uuidList,
    excludeDynamicSegmentIds: uuidList, eventRule: eventRuleSchema.nullable().optional(), nextId: next }).strict(),
  z.object({ id, type: z.literal('wait_event'), eventName: z.string().max(64), filters: z.array(eventFilterSchema).max(10),
    timeoutHours: z.number().int().min(0).max(100_000), timeoutMinutes: z.number().int().min(0).max(59).optional(), matchedNextId: next, timeoutNextId: next }).strict(),
  z.object({ id, type: z.literal('event_split'), rule: eventRuleSchema, yesNextId: next, noNextId: next }).strict(),
  z.object({ id, type: z.literal('wait'), hours: z.number().int().min(0).max(100_000), minutes: z.number().int().min(0).max(59).optional(), nextId: next }).strict(),
  z.object({ id, type: z.literal('condition'), expression: z.string().max(2000), yesNextId: next, noNextId: next }).strict(),
  z.object({ id, type: z.literal('split'), branches: z.array(z.object({ id, label: z.string().max(80), percent: z.number(), nextId: next }).strict()).max(10) }).strict(),
  z.object({ id, type: z.literal('action'), nextId: next, action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('notify'), channels: z.array(z.enum(['push', 'email', 'in_app'])).max(3), templateKey: z.string().max(100), data: z.record(z.string(), z.unknown()).optional() }).strict(),
    z.object({ kind: z.literal('grant_coupon'), couponId: z.string().max(64) }).strict(),
  ]) }).strict(),
  webhookStep,
]);
export const workflowInputSchema = z.object({
  name: z.string().max(200), triggerType: z.enum(['scheduled', 'order_milestone', 'first_login', 'app_login', 'event']),
  triggerConfig: z.record(z.string(), z.unknown()), entryStepId: id.nullable(), steps: z.array(stepSchema).max(60),
  graphUi: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).nullable(), cooldownDays: z.number().int(), holdoutPercent: z.number().int(),
  conversionWindowDays: z.number().int(), exitOnGoal: z.union([z.object({ kind: z.literal('order_placed') }).strict(),
    z.object({ kind: z.literal('event'), eventName: z.string().max(64), filters: z.array(eventFilterSchema).max(10) }).strict()]).nullable(),
  schedule: z.object({ timezone: z.string().max(64), daysOfWeek: z.array(z.number().int()).max(7).optional(), startTime: z.string().max(5).optional(),
    endTime: z.string().max(5).optional(), activeFrom: z.string().nullable().optional(), activeTo: z.string().nullable().optional() }).strict().nullable(),
}).strict();
export const expressionSchema = z.object({ expression: z.string().max(2000) }).strict();
export const webhookTestSchema = z.object({ step: webhookStep }).strict();
export const secretCreateSchema = z.object({ name: z.string().min(1).max(128), value: z.string().min(1).max(4000) }).strict();
export const secretReplaceSchema = z.object({ value: z.string().min(1).max(4000) }).strict();
export const testRunSchema = z.object({ userId: z.string().uuid(), skipWaits: z.boolean(), eventAttributes: z.record(z.string(), z.unknown()).optional() }).strict();
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
