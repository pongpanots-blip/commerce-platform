import { z } from 'zod';
export type SalesKind = 'opportunities' | 'leads';
const id = z.uuid().transform(v => v.toLowerCase()), label = z.string().min(1).max(1000), optional = z.string().max(1000).nullable();
const pagination = z.object({ total: z.number().int().nonnegative(), capped: z.boolean().optional() });
const opportunity = z.object({ id, name: label, district: optional.optional(), meta: z.object({ stage: optional, ownerSalesUserId: id.nullable(), ownerName: optional }) });
const lead = z.object({ id, displayName: label, stage: label, assignedSalesUserId: id.nullable() });
export function parseSalesPage(raw: unknown, kind: SalesKind) {
  const parsed = kind === 'opportunities' ? z.object({ data: z.object({ items: z.array(opportunity).max(20), pagination }) }).parse(raw) : z.object({ data: z.array(lead).max(20), meta: pagination }).parse(raw);
  const data = kind === 'opportunities' ? (parsed as z.infer<typeof opportunitiesEnvelope>).data : null;
  const pool = kind === 'leads' ? parsed as z.infer<typeof leadsEnvelope> : null;
  const rows = data ? data.items.map(r => ({ id: r.id, name: r.name, stage: r.meta.stage, ownerId: r.meta.ownerSalesUserId, ownerName: r.meta.ownerName, district: r.district ?? null })) : pool!.data.map(r => ({ id: r.id, name: r.displayName, stage: r.stage, ownerId: r.assignedSalesUserId, ownerName: null, district: null }));
  const meta = data?.pagination ?? pool!.meta;
  if (rows.length > meta.total || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Inconsistent returned sales records');
  return { rows, total: meta.total, capped: meta.capped ?? false };
}
const opportunitiesEnvelope = z.object({ data: z.object({ items: z.array(opportunity), pagination }) });
const leadsEnvelope = z.object({ data: z.array(lead), meta: pagination });
export function salesWorkQuery(params: URLSearchParams) {
  const raw = params.get('page') ?? '1', q = params.get('q') ?? '';
  if (params.getAll('page').length > 1 || params.getAll('q').length > 1 || [...params.keys()].some(k => !['page', 'q'].includes(k)) || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > 100000 || q.length > 120 || /[\x00-\x1f\x7f]/.test(q)) return { page: 1, q: '', error: true };
  return { page: Number(raw), q, error: false };
}
export const salesRecordId = (value: string | undefined) => id.safeParse(value);
