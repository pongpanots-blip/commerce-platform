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
