import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { GrowthPlanInput } from '@cp/growth';
import { GrowthService } from './growth.service';
import { GrowthCampaignPlan } from './growth-plan.entity';
import { assertCitations, parse, planSchema } from './growth.validation';
import { GrowthAiService } from './growth-ai.service';

const id = '11111111-1111-4111-8111-111111111111';
const workflowId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: id, email: 'owner@test.local', role: 'marketing' };
const admin = { ...actor, role: 'admin' };
const input: GrowthPlanInput = {
  title: 'เรียกลูกค้ากลับ', goal: 'ซื้อซ้ำโดยตรวจข้อเสนอ', template: 'winback', owner: 'ทีมขาย',
  segmentIds: [workflowId], excludeSegmentIds: [], productSkus: [], notifyTemplateKey: null,
  scheduleAt: null, budgetThb: 2000, minimumMarginPercent: 20, holdoutPercent: 10,
  cooldownDays: 7, conversionWindowDays: 14, variants: [{ label: 'A', title: 'กลับมาซื้อ', body: 'ดูรายการสินค้า', evidenceIds: ['fact:1'] }],
  selectedVariant: 0, researchTopicId: null, researchRunId: null,
};

describe('Growth approval and draft export', () => {
  let rows: Map<string, GrowthCampaignPlan>, service: GrowthService, josh: { configured: boolean; run: jest.Mock };
  let facts: jest.Mock;
  beforeEach(() => {
    rows = new Map();
    const manager = {
      findOne: jest.fn(async (_: unknown, options: { where: { id: string } }) => rows.get(options.where.id)),
      find: jest.fn(async () => [...rows.values()]),
      save: jest.fn(async (p: GrowthCampaignPlan) => { p.updatedAt = new Date(); rows.set(p.id, p); return p; }),
      createQueryBuilder: () => {
        let values: Partial<GrowthCampaignPlan>;
        const q = { insert: () => q, into: () => q, values: (v: Partial<GrowthCampaignPlan>) => { values = v; return q; }, orIgnore: () => q,
          execute: async () => { if (!rows.has(values.id!)) rows.set(values.id!, { approvedBy: null, approvedVersion: null, workflowId: null,
            createdAt: new Date(), updatedAt: new Date(), ...values } as GrowthCampaignPlan); } };
        return q;
      },
    };
    josh = { configured: true, run: jest.fn(async (target: string, _action: string, args: Record<string, unknown>) => target === 'admin-call'
      ? { status: 200, data: { data: { template_key: 'custom_approved', template_type: 'notify', title: input.variants[0].title, body: input.variants[0].body } } }
      : { data: { ...args.workflow as object, id: workflowId, status: 'draft' } }) };
    facts = jest.fn(async () => ({ evidence: [{ id: 'fact:1', source: 'sales', title: 'ยอดขาย', url: null, excerpt: '10 orders', collectedAt: new Date().toISOString() }] }));
    service = new GrowthService({ manager, transaction: async (fn: (m: unknown) => unknown) => fn(manager) } as never,
      { workspace: facts } as never,
      { configured: false } as never, josh as never, { configured: false } as never);
  });
  async function approve(plan = input) {
    await service.create(id, plan, actor);
    const review = await service.review(id, 1, false, actor);
    return service.review(id, review.version, true, admin);
  }
  it('retries the same creation without duplicating; rejects reused request IDs', async () => {
    await service.create(id, input, actor);
    facts.mockResolvedValue({ evidence: [] }); // Facts change after a lost creation response.
    await service.create(id, input, actor);
    expect(rows.size).toBe(1);
    expect(facts).toHaveBeenCalledTimes(1);
    await expect(service.create(id, { ...input, budgetThb: 9 }, actor)).rejects.toBeInstanceOf(ConflictException);
  });
  it('requires owner rights, current version, and admin approval', async () => {
    await service.create(id, input, actor);
    await expect(service.update(id, 1, input, { ...actor, userId: workflowId })).rejects.toBeInstanceOf(ForbiddenException);
    await service.review(id, 1, false, actor);
    await expect(service.review(id, 2, true, actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update(id, 1, input, actor)).rejects.toBeInstanceOf(ConflictException);
  });
  it('edits invalidate approval and preserve cited evidence in revision history', async () => {
    const p = await approve();
    const next = await service.update(id, p.version, { ...input, budgetThb: 2100 }, actor);
    expect(next).toMatchObject({ status: 'draft', approvedBy: null, approvedVersion: null });
    const history = rows.get(id)!.history;
    expect(history[history.length - 1]?.evidence?.[0].id).toBe('fact:1');
    await expect(service.export(id, next.version, actor)).rejects.toBeInstanceOf(ConflictException);
  });
  it('exports exactly approved content as draft, with audience, holdout and goal exit, never activates', async () => {
    const p = await approve(); const exported = await service.export(id, p.version, actor);
    expect(exported).toMatchObject({ status: 'ready', workflowId });
    const template = josh.run.mock.calls[0][2].body;
    expect(template).toMatchObject({ title: input.variants[0].title, body: input.variants[0].body });
    const workflow = josh.run.mock.calls[1][2].workflow;
    expect(workflow).toMatchObject({ holdout_percent: 10, cooldown_days: 7, exit_on_goal: { kind: 'order_placed' } });
    expect(workflow.steps[0].segmentIds).toEqual(input.segmentIds);
    expect(workflow.steps[1].action).toMatchObject({ kind: 'notify', templateKey: 'custom_approved', channels: ['in_app'] });
    expect(josh.run.mock.calls.some(c => c[1] === 'activate')).toBe(false);
  });
  it('ambiguous external write blocks retries rather than creating duplicate workflows', async () => {
    const p = await approve();
    josh.run.mockImplementation(async target => {
      if (target === 'admin-call') return { status: 200, data: { data: { template_key: 'custom_approved', template_type: 'notify', title: input.variants[0].title, body: input.variants[0].body } } };
      throw new BadGatewayException('timeout');
    });
    await expect(service.export(id, p.version, actor)).rejects.toBeInstanceOf(BadGatewayException);
    const current = await service.detail(id, actor);
    expect(current.status).toBe('export_unknown');
    await expect(service.export(id, current.version, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(josh.run).toHaveBeenCalledTimes(2);
  });
  it('a failure before workflow creation leaves approval retryable', async () => {
    const p = await approve(); josh.run.mockRejectedValue(new BadRequestException('template invalid'));
    await expect(service.export(id, p.version, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.detail(id, actor)).status).toBe('approved');
  });
  it.each([
    { channels: { push: { title: 'unapproved' } } }, { title_en: 'unapproved' }, { body_en: 'unapproved' },
    { image_url: 'https://example.test/unapproved.png' }, { blocks: [{ text: 'unapproved' }] }, { variants: [{ body: 'unapproved' }] },
  ])('rejects template content outside the approval snapshot: %j', async override => {
    const p = await approve({ ...input, notifyTemplateKey: 'custom_existing' });
    josh.run.mockResolvedValue({ status: 200, data: { data: [{ template_key: 'custom_existing', template_type: 'notify', title: input.variants[0].title, body: input.variants[0].body, ...override }] } });
    await expect(service.export(id, p.version, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(josh.run).toHaveBeenCalledTimes(1);
    expect((await service.detail(id, actor)).status).toBe('approved');
  });
  it('reconciliation verifies graph and copy, not only the exported name', async () => {
    const p = await approve();
    josh.run.mockImplementation(async (target, _action, args) => {
      if (target === 'admin-call') return { status: 200, data: { data: { template_key: 'custom_approved', template_type: 'notify', title: input.variants[0].title, body: input.variants[0].body } } };
      throw new BadGatewayException('timeout');
    });
    await expect(service.export(id, p.version, actor)).rejects.toBeInstanceOf(BadGatewayException);
    const workflow = josh.run.mock.calls[1][2].workflow;
    const current = await service.detail(id, admin);
    josh.run.mockResolvedValue({ status: 200, data: { data: { ...workflow, id: workflowId, status: 'draft', holdout_percent: 0 } } });
    await expect(service.reconcile(id, current.version, workflowId, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.detail(id, admin)).status).toBe('export_unknown');
  });
  it('validates money, audience overlap, variant and citation boundaries', () => {
    expect(() => parse(planSchema, { ...input, budgetThb: -1 })).toThrow(BadRequestException);
    expect(() => parse(planSchema, { ...input, holdoutPercent: 10.5 })).toThrow(BadRequestException);
    expect(() => parse(planSchema, { ...input, excludeSegmentIds: [workflowId] })).toThrow(BadRequestException);
    expect(() => parse(planSchema, { ...input, selectedVariant: 1 })).toThrow(BadRequestException);
    expect(() => assertCitations(input, new Set())).toThrow(BadRequestException);
  });
});

describe('Growth AI grounding boundary', () => {
  const env = process.env, fetcher = global.fetch;
  afterEach(() => { process.env = env; global.fetch = fetcher; });
  it('fails explicitly when no provider is configured', async () => {
    process.env = { ...env, OPENAI_API_KEY: '', GROWTH_AI_MODEL: '' }; global.fetch = jest.fn();
    await expect(new GrowthAiService().draft(id, input, [], 'ร่าง')).rejects.toThrow('AI ยังไม่พร้อม');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('rejects fabricated evidence and calls only a draft endpoint with store:false', async () => {
    process.env = { ...env, OPENAI_API_KEY: 'test-only', GROWTH_AI_MODEL: 'configured-model' };
    const draft = { variants: [input.variants[0], input.variants[0]], rationale: 'ร่างตามข้อมูล', evidenceIds: ['invented'] };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }] }) });
    await expect(new GrowthAiService().draft(id, input, [], 'ร่าง')).rejects.toThrow('AI อ้างหลักฐาน');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses'); expect(JSON.parse(init.body)).toMatchObject({ store: false });
  });
});
