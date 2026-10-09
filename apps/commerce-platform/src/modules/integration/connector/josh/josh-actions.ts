import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../../core/audit/infrastructure/audit-log.entity';
import { GrowthCampaignPlan } from '../../growth/growth-plan.entity';
import { User } from '../../../core/user/infrastructure/user.entity';

export type JoshActionTarget = 'winback' | 'push-campaigns' | 'credit-applications' | 'admin-access' | 'coupons' | 'customer-prices' | 'contract-prices' | 'products' | 'promotions' | 'suppliers' | 'internal-docs' | 'marketing-workflows' | 'customers' | 'admin-call';
export interface JoshActionActor { userId: string; email: string }

/**
 * Staff actions commerce asks josh to do (josh `POST /api/internal/commerce/{winback,push-campaigns}`).
 * josh's own services do the work, so josh stays the only writer and sender. The whole envelope —
 * action, args, who, when, nonce — is HMAC-signed with JOSH_EVENTS_SECRET (= josh's
 * COMMERCE_EVENTS_SECRET); josh acts as its commerce-platform service account and records the staff
 * email in its audit — commerce staff need no josh account, commerce decides who may do what. Every call is
 * audited here, success or not.
 */
@Injectable()
export class JoshActions {
  constructor(private readonly db: DataSource) {}

  get configured() { return !!process.env.JOSH_API_URL?.trim() && !!process.env.JOSH_EVENTS_SECRET?.trim(); }

  async run<T = unknown>(target: JoshActionTarget, action: string, args: Record<string, unknown>, actor: JoshActionActor, via: string): Promise<T> {
    return this.send<T>(target, action, args, actor, via, (text, signature) => ({
      url: `internal/commerce/${target}`, timeout: 60_000,
      init: { body: text, headers: { 'content-type': 'application/json', 'x-signature': signature } },
    }));
  }

  /**
   * admin-call with real files (videos, bulk images): multipart to josh `/admin-call/upload`. The
   * signed envelope rides in a header and lists each file's size and sha256, so josh checks the
   * signature before reading the files and refuses a file that is not the one signed for.
   */
  async upload<T = unknown>(args: Record<string, unknown>, files: UploadFile[], actor: JoshActionActor, via: string): Promise<T> {
    const streamedFiles = files.map((f) => ({ field: f.field, filename: f.filename, contentType: f.contentType, size: f.bytes.length, sha256: createHash('sha256').update(f.bytes).digest('hex') }));
    return this.send<T>('admin-call', 'call', { ...args, streamedFiles }, actor, via, (text, signature) => {
      const form = new FormData();
      for (const f of files) form.append(f.field, new Blob([new Uint8Array(f.bytes)], { type: f.contentType || 'application/octet-stream' }), f.filename);
      return { url: 'internal/commerce/admin-call/upload', timeout: 300_000,
        init: { body: form, headers: { 'x-commerce-envelope': Buffer.from(text).toString('base64url'), 'x-signature': signature } } };
    });
  }

  private async send<T>(target: JoshActionTarget, action: string, args: Record<string, unknown>, actor: JoshActionActor, via: string,
    request: (text: string, signature: string) => { url: string; timeout: number; init: { body: BodyInit; headers: Record<string, string> } }, audited: object = args): Promise<T> {
    if (!this.configured) throw new ServiceUnavailableException('josh is not connected on this server (JOSH_API_URL / JOSH_EVENTS_SECRET).');
    await this.guardGrowthWorkflow(target, action, args, actor);
    const body = { action, args, actorEmail: actor.email, at: new Date().toISOString(), nonce: randomUUID() };
    const text = JSON.stringify(body);
    const r = request(text, createHmac('sha256', process.env.JOSH_EVENTS_SECRET!.trim()).update(text).digest('hex'));
    let status = 0;
    let answer: unknown = null;
    try {
      const res = await fetch(`${process.env.JOSH_API_URL!.trim().replace(/\/$/, '')}/${r.url}`, { method: 'POST', ...r.init, signal: AbortSignal.timeout(r.timeout) });
      status = res.status;
      const raw = await res.text();
      try { answer = raw ? JSON.parse(raw) : null; } catch { answer = raw; }
      if (!res.ok) throw joshError(status, answer);
      return answer as T;
    } finally {
      await this.db.getRepository(AuditLog).insert({
        actorId: actor.userId, action: `josh.${target}.${action}`, entityType: 'josh_action', entityId: null,
        after: (target === 'admin-call' ? withoutFileBytes(audited) : audited) as object, context: { via, email: actor.email, joshStatus: status },
      });
    }
  }

  /** All commerce doors (editor, controller and MCP) share this boundary. Growth exports cannot send until runtime guard support exists. */
  private async guardGrowthWorkflow(target: JoshActionTarget, action: string, args: Record<string, unknown>, actor: JoshActionActor) {
    let id: string | undefined, operation = action;
    if (target === 'marketing-workflows' && ['update', 'activate', 'test'].includes(action)) id = String(args.id ?? '');
    if (target === 'admin-call') {
      const method = String(args.method ?? '').toUpperCase();
      const match = String(args.path ?? '').match(/^\/marketing-workflows\/([0-9a-f-]{36})(?:\/(.*))?$/i);
      if (!match || method === 'GET' || method === 'DELETE' || ['pause', 'preview'].includes(match[2])) return;
      id = match[1]; operation = match[2] || 'update';
    }
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    const response = await this.run<{ status: number; data: unknown }>('admin-call', 'call', { method: 'GET', path: `/marketing-workflows/${id}` }, actor, 'growth-guard');
    if (response.status >= 400) throw new BadGatewayException('ตรวจสถานะ workflow ก่อนเปลี่ยนแปลงไม่สำเร็จ');
    const body = response.data as { data?: { name?: string }; name?: string };
    const workflow = body?.data ?? body;
    const marker = workflow?.name?.match(/^Growth \[([0-9a-f-]{36}):v\d+\]/i);
    if (!marker) return;
    if (operation !== 'update') throw new ForbiddenException('Growth workflow นี้เปิดส่งหรือทดสอบส่งจริงไม่ได้: ต้องรองรับ stock/margin/budget/consent guards ก่อน');
    const edit = (target === 'admin-call' ? args.body : args.workflow) as { name?: unknown } | undefined;
    if (edit?.name !== undefined && (typeof edit.name !== 'string' || !edit.name.startsWith(`${marker[0]} `))) throw new ForbiddenException('เก็บรหัสแผน Growth ไว้ในชื่อ workflow');
    await this.db.transaction(async manager => {
      const plan = await manager.findOne(GrowthCampaignPlan, { where: { id: marker[1] }, lock: { mode: 'pessimistic_write' } });
      if (plan && plan.createdBy !== actor.userId) {
        const staff = await manager.findOne(User, { where: { id: actor.userId } });
        if (staff?.role !== 'admin' || staff.status !== 'active') throw new ForbiddenException('เฉพาะเจ้าของแผน Growth หรือ admin ที่แก้ workflow นี้ได้');
      }
      if (plan && ['exporting', 'export_unknown'].includes(plan.status)) throw new ConflictException('ตรวจสอบผลส่งออกก่อนแก้ workflow');
      if (plan?.workflowId !== id) return;
      plan.version++; plan.status = 'draft'; plan.approvedBy = null; plan.approvedVersion = null;
      plan.history.push({ at: new Date().toISOString(), actor: actor.email, action: 'workflow_edit_requires_review', version: plan.version, snapshot: plan.plan });
      await manager.save(plan);
    });
  }
}

export interface UploadFile { field: string; filename: string; contentType?: string; bytes: Buffer }

/** The audit keeps who / what / which files, not the file contents. */
function withoutFileBytes(args: object) {
  const a = args as { files?: { base64?: string }[] };
  return a.files ? { ...a, files: a.files.map(({ base64, ...f }) => ({ ...f, bytes: Math.round((base64?.length ?? 0) * 0.75) })) } : args;
}

/** josh's answer → the same kind of error here, with josh's message (Thai text included). */
function joshError(status: number, answer: unknown) {
  const m = (answer as { message?: unknown; error?: { message?: unknown } })?.message ?? (answer as { error?: { message?: unknown } })?.error?.message;
  const message = `josh: ${Array.isArray(m) ? m.join(', ') : String(m ?? status)}`;
  // josh's promotion SKU-clash check lists the clashing SKUs; the form highlights them
  const duplicateSkus = (answer as { duplicate_skus?: unknown })?.duplicate_skus;
  if (status === 400) return new BadRequestException(Array.isArray(duplicateSkus) ? { message, duplicate_skus: duplicateSkus } : message);
  if (status === 403) return new ForbiddenException(message);
  if (status === 404) return new NotFoundException(`${message} (or commerce actions are off on josh: COMMERCE_ACTIONS_ENABLED)`);
  return new BadGatewayException(message);
}
