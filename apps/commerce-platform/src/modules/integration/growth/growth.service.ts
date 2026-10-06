import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DataSource, EntityManager } from 'typeorm';
import type { GrowthEvidence, GrowthPlan, GrowthPlanInput, GrowthPlanPage, GrowthReadiness, GrowthStatus, GrowthTask } from '@cp/growth';
import { JoshActions } from '../connector/josh/josh-actions';
import { joshAdminCall } from '../connector/josh/josh-admin-call.controller';
import { JoshReplica } from '../connector/josh/josh-replica';
import { GrowthCampaignPlan as Plan } from './growth-plan.entity';
import { GrowthDataService } from './growth-data.service';
import { GrowthAiService } from './growth-ai.service';
import { assertCitations, assertReviewable } from './growth.validation';

export interface GrowthActor { userId: string; email: string; role: string }
const unwrap = (value: unknown): unknown => value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : value;
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const marker = (p: Plan) => `Growth [${p.id}:v${p.approvedVersion}]`;

@Injectable()
export class GrowthService {
  constructor(private readonly db: DataSource, private readonly data: GrowthDataService, private readonly ai: GrowthAiService,
    private readonly josh: JoshActions, private readonly replica: JoshReplica) {}

  readiness(): GrowthReadiness {
    return { ai: this.ai.configured, workflow: this.josh.configured, replica: this.replica.configured,
      activationBlockers: ['ส่งออกได้เฉพาะร่างที่หยุดไว้: engine เดิมยังไม่ยืนยันการตรวจสต็อก/กำไรและเพดานงบทุกครั้งที่ส่ง',
        'ต้องยืนยัน consent, quiet hours และความถี่รวมของช่องทางก่อนเปิดส่ง', 'holdout เดิมสุ่มต่อ enrollment; ยังไม่ใช่การสุ่มคงที่ระดับบริษัท'] };
  }
  private canManage(p: Plan, a: GrowthActor) { return a.role === 'admin' || p.createdBy === a.userId; }
  private view(p: Plan, a: GrowthActor): GrowthPlan {
    return { ...p.plan, id: p.id, createdBy: p.createdBy, version: p.version, status: p.status, approvedBy: p.approvedBy,
      approvedVersion: p.approvedVersion, workflowId: p.workflowId, evidence: p.evidence, tasks: p.tasks, history: p.history,
      createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), canManage: this.canManage(p, a) };
  }
  private async load(m: EntityManager, id: string, lock = false): Promise<Plan> {
    const p = await m.findOne(Plan, { where: { id }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!p) throw new NotFoundException('ไม่พบแผน Growth');
    return p;
  }
  private assertMutable(p: Plan, version: number, a: GrowthActor) {
    if (!this.canManage(p, a)) throw new ForbiddenException('เฉพาะเจ้าของแผนหรือ admin ที่แก้ไขได้');
    if (p.version !== version) throw new ConflictException('แผนถูกแก้ไขแล้ว โหลดเวอร์ชันล่าสุดก่อนทำต่อ');
    if (p.status === 'exporting' || p.status === 'export_unknown') throw new ConflictException('ตรวจสอบผลส่งออกก่อนแก้ไขหรือส่งออกซ้ำ');
  }
  private change(p: Plan, a: GrowthActor, action: string) {
    p.version++;
    p.history.push({ at: new Date().toISOString(), actor: a.email, action, version: p.version, snapshot: p.plan, evidence: p.evidence });
  }
  private async evidence(plan: GrowthPlanInput, a: GrowthActor): Promise<GrowthEvidence[]> {
    const facts = (await this.data.workspace()).evidence;
    const research = plan.researchTopicId && plan.researchRunId ? await this.data.researchEvidence(plan.researchTopicId, plan.researchRunId, a) : [];
    return [...new Map([...facts, ...research].map(e => [e.id, e])).values()];
  }
  async list(a: GrowthActor, q: { page: number; limit: number; search: string; status?: GrowthStatus; month?: string }): Promise<GrowthPlanPage> {
    const query = this.db.manager.createQueryBuilder(Plan, 'p');
    if (q.search) query.andWhere("(p.plan->>'title' ILIKE :search OR p.plan->>'owner' ILIKE :search OR p.plan->>'goal' ILIKE :search)", { search: `%${q.search}%` });
    if (q.status) query.andWhere('p.status = :status', { status: q.status });
    if (q.month) query.andWhere("to_char((p.plan->>'scheduleAt')::timestamptz AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') = :month", { month: q.month });
    const [items, totalCount] = await query.orderBy('p.updatedAt', 'DESC').addOrderBy('p.id', 'DESC').skip((q.page - 1) * q.limit).take(q.limit).getManyAndCount();
    return { items: items.map(p => this.view(p, a)), totalCount, page: q.page, limit: q.limit };
  }
  async detail(id: string, a: GrowthActor) { return this.view(await this.load(this.db.manager, id), a); }
  async create(id: string, plan: GrowthPlanInput, a: GrowthActor) {
    const requestHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    const existing = await this.db.manager.findOne(Plan, { where: { id } });
    if (existing) {
      if (existing.createdBy !== a.userId || existing.requestHash !== requestHash) throw new ConflictException('requestId นี้ถูกใช้กับแผนอื่นแล้ว');
      return this.view(existing, a);
    }
    const evidence = await this.evidence(plan, a);
    assertCitations(plan, new Set(evidence.map(e => e.id)));
    return this.db.transaction(async m => {
      await m.createQueryBuilder().insert().into(Plan).values({ id, createdBy: a.userId, requestHash, plan, evidence,
        tasks: [], history: [{ at: new Date().toISOString(), actor: a.email, action: 'created', version: 1, snapshot: plan, evidence }],
        status: 'draft', version: 1 }).orIgnore().execute();
      const p = await this.load(m, id);
      if (p.createdBy !== a.userId || p.requestHash !== requestHash) throw new ConflictException('requestId นี้ถูกใช้กับแผนอื่นแล้ว');
      return this.view(p, a);
    });
  }
  async update(id: string, version: number, plan: GrowthPlanInput, a: GrowthActor) {
    const evidence = await this.evidence(plan, a);
    return this.db.transaction(async m => {
      const p = await this.load(m, id, true); this.assertMutable(p, version, a);
      assertCitations(plan, new Set([...p.evidence, ...evidence].map(e => e.id)));
      this.change(p, a, 'revised');
      p.plan = plan; p.evidence = [...new Map([...p.evidence, ...evidence].map(e => [e.id, e])).values()];
      p.status = 'draft'; p.approvedBy = null; p.approvedVersion = null;
      // Existing exports remain paused and immutable; each approved revision gets a new workflow.
      p.workflowId = null;
      return this.view(await m.save(p), a);
    });
  }
  async review(id: string, version: number, approve: boolean, a: GrowthActor) {
    return this.db.transaction(async m => {
      const p = await this.load(m, id, true); this.assertMutable(p, version, a);
      if (approve && a.role !== 'admin') throw new ForbiddenException('admin เป็นผู้อนุมัติ');
      if (p.status !== (approve ? 'review' : 'draft')) throw new ConflictException('สถานะแผนไม่พร้อมสำหรับการดำเนินการนี้');
      assertReviewable(p.plan); this.change(p, a, approve ? 'approved' : 'submitted');
      p.status = approve ? 'approved' : 'review';
      p.approvedBy = approve ? a.userId : null; p.approvedVersion = approve ? p.version : null;
      return this.view(await m.save(p), a);
    });
  }
  async tasks(id: string, version: number, tasks: GrowthTask[], a: GrowthActor) {
    return this.db.transaction(async m => {
      const p = await this.load(m, id, true); this.assertMutable(p, version, a);
      // A task edit is not a campaign edit. Advance optimistic version, preserving approved content revision.
      this.change(p, a, 'tasks_updated'); p.tasks = tasks;
      return this.view(await m.save(p), a);
    });
  }
  async draft(id: string, version: number, instruction: string, a: GrowthActor) {
    const p = await this.load(this.db.manager, id); this.assertMutable(p, version, a);
    // Use the visible persisted snapshot. A revision explicitly refreshes evidence and keeps the old citations.
    return this.ai.draft(a.userId, p.plan, p.evidence, instruction);
  }
  private call(a: GrowthActor, method: string, path: string, body?: unknown) {
    return joshAdminCall(this.josh, a, { method, path, body }, 'growth');
  }
  private async template(p: Plan, a: GrowthActor): Promise<string> {
    const v = p.plan.variants[p.plan.selectedVariant];
    if (p.plan.notifyTemplateKey) {
      const rows = unwrap(await this.call(a, 'GET', '/marketing-notify-templates'));
      if (!Array.isArray(rows)) throw new BadGatewayException('อ่าน notification templates ไม่สำเร็จ');
      const t = rows.map(record).find(t => t.template_key === p.plan.notifyTemplateKey);
      this.assertTemplate(t, v);
      return p.plan.notifyTemplateKey;
    }
    const t = record(unwrap(await this.call(a, 'POST', '/marketing-notify-templates', {
      name: marker(p), template_type: 'notify', title: v.title, body: v.body,
    })));
    if (typeof t.template_key !== 'string' || !/^custom_[a-zA-Z0-9_-]+$/.test(t.template_key)) throw new BadGatewayException('สร้าง notification template แล้ว แต่คำตอบไม่ครบ');
    this.assertTemplate(t, v);
    return t.template_key;
  }
  private assertTemplate(t: Record<string, unknown> | undefined, v: { title: string; body: string }) {
    if (!t || t.template_type !== 'notify' || t.title !== v.title || t.body !== v.body || t.channels != null ||
      t.title_en || t.body_en || t.image_url || (Array.isArray(t.blocks) && t.blocks.length) || (Array.isArray(t.variants) && t.variants.length))
      throw new BadRequestException('ใช้ notify template ที่มีข้อความตรงกับแผนและไม่มี channel/ภาษา/layout override หรือเว้น template key เพื่อสร้างข้อความใหม่');
  }
  private workflow(p: Plan, templateKey: string) {
    const cart = p.plan.template === 'cart_idle';
    return {
      name: `${marker(p)} ${p.plan.title}`.slice(0, 200), trigger_type: cart ? 'cart_idle' : 'scheduled',
      trigger_config: cart ? { idleHours: 1 } : { time: p.plan.scheduleAt ? new Date(p.plan.scheduleAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '10:00', timezone: 'Asia/Bangkok' },
      steps: [{ id: 'audience', type: 'audience', segmentIds: p.plan.segmentIds, excludeSegmentIds: p.plan.excludeSegmentIds },
        ...(cart ? [{ id: 'open', type: 'gate', kind: 'cart_still_open' }] : []),
        { id: 'notify', type: 'action', action: { kind: 'notify', channels: ['in_app'], templateKey } }],
      cooldown_days: p.plan.cooldownDays, holdout_percent: p.plan.holdoutPercent, conversion_window_days: p.plan.conversionWindowDays,
      exit_on_goal: { kind: cart ? 'cart_converted' : 'order_placed' },
      schedule: { timezone: 'Asia/Bangkok', startTime: '09:00', endTime: '20:00', activeFrom: p.plan.scheduleAt,
        activeTo: p.plan.scheduleAt ? new Date(new Date(p.plan.scheduleAt).getTime() + 86400000).toISOString() : null },
    };
  }
  private assertWorkflow(p: Plan, w: Record<string, unknown>, templateKey: string) {
    const expected = this.workflow(p, templateKey);
    if (!Object.entries(expected).every(([key, value]) => isDeepStrictEqual(w[key], value)))
      throw new BadRequestException('workflow ถูกแก้ไขหรือไม่ตรงกับเนื้อหา กลุ่ม และกฎของแผนที่อนุมัติ');
  }
  async export(id: string, version: number, a: GrowthActor) {
    if (!this.josh.configured) throw new ServiceUnavailableException('ยังไม่ได้เชื่อม josh สำหรับส่งออกร่าง workflow');
    const p = await this.db.transaction(async m => {
      const p = await this.load(m, id, true); this.assertMutable(p, version, a);
      if (p.status !== 'approved' || !p.approvedBy || !p.approvedVersion) throw new ConflictException('ต้องอนุมัติแผนเวอร์ชันนี้ก่อนส่งออก');
      assertReviewable(p.plan); this.change(p, a, 'export_started'); p.status = 'exporting';
      return m.save(p);
    });
    let workflowAttempted = false;
    try {
      const templateKey = await this.template(p, a);
      const workflow = this.workflow(p, templateKey);
      workflowAttempted = true;
      const answer = record(unwrap(await this.josh.run('marketing-workflows', 'create', { workflow }, a, 'growth')));
      if (typeof answer.id !== 'string' || !uuid.test(answer.id) || answer.status !== 'draft') throw new BadGatewayException('ไม่สามารถยืนยัน ID และสถานะ draft ของ workflow ที่สร้าง');
      try { this.assertWorkflow(p, answer, templateKey); } catch { throw new BadGatewayException('workflow ที่สร้างไม่ตรงกับแผนที่อนุมัติ'); }
      return await this.finishExport(p.id, answer.id, a);
    } catch (error) {
      const uncertain = workflowAttempted && !(error instanceof BadRequestException || error instanceof ForbiddenException);
      // An upstream timeout or a local audit failure may happen after the write. Never blindly retry it.
      await this.db.transaction(async m => {
        const current = await this.load(m, id, true);
        if (current.status === 'exporting') {
          this.change(current, a, uncertain ? 'export_outcome_unknown' : 'export_rejected');
          current.status = uncertain ? 'export_unknown' : 'approved'; await m.save(current);
        }
      });
      if (!uncertain) throw error;
      throw new BadGatewayException('ยังยืนยันผลส่งออกไม่ได้ ตรวจ workflow ชื่อ Growth ตามรหัสแผน แล้วให้ admin ผูก ID; ไม่ส่งออกซ้ำอัตโนมัติ');
    }
  }
  private async finishExport(id: string, workflowId: string, a: GrowthActor) {
    return this.db.transaction(async m => {
      const p = await this.load(m, id, true);
      if (!['exporting', 'export_unknown'].includes(p.status)) throw new ConflictException('สถานะแผนเปลี่ยนระหว่างส่งออก');
      this.change(p, a, 'draft_exported'); p.status = 'ready'; p.workflowId = workflowId;
      return this.view(await m.save(p), a);
    });
  }
  async reconcile(id: string, version: number, workflowId: string, a: GrowthActor) {
    if (a.role !== 'admin') throw new ForbiddenException('admin เท่านั้นที่ยืนยันผลส่งออก');
    const p = await this.load(this.db.manager, id);
    if (p.version !== version || !['exporting', 'export_unknown'].includes(p.status)) throw new ConflictException('แผนไม่อยู่ในสถานะตรวจสอบผลส่งออก');
    const w = record(unwrap(await this.call(a, 'GET', `/marketing-workflows/${workflowId}`)));
    if (typeof w.name !== 'string' || !w.name.startsWith(`${marker(p)} `) || !['draft', 'paused'].includes(String(w.status))) throw new BadRequestException('ID นี้ไม่ใช่ร่างของแผนและเวอร์ชันที่กำลังตรวจ');
    const steps = Array.isArray(w.steps) ? w.steps.map(record) : [];
    const templateKey = record(steps.find(s => s.id === 'notify')?.action).templateKey;
    if (typeof templateKey !== 'string') throw new BadRequestException('workflow ไม่มี notification template ที่ตรวจได้');
    this.assertWorkflow(p, w, templateKey);
    const templates = unwrap(await this.call(a, 'GET', '/marketing-notify-templates'));
    const t = Array.isArray(templates) ? templates.map(record).find(t => t.template_key === templateKey) : undefined;
    const selected = p.plan.variants[p.plan.selectedVariant];
    this.assertTemplate(t, selected);
    return this.finishExport(id, workflowId, a);
  }
}
