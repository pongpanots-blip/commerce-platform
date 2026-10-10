import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UnprocessableEntityException } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { parse } from '../../growth/growth.validation';
import { MarketingTesters } from '../../connector/josh/marketing-testers';
import { checkExpression } from '../domain/expression.fields';
import { renderWebhook, secretIdsOf, webhookVars } from '../domain/template';
import type { WebhookTestResult, WorkflowInput, WorkflowStep } from '../domain/workflow.types';
import { sendWebhook, WebhookSendError } from '../application/webhook-send';
import { WebhookSecretsService } from '../application/webhook-secrets.service';
import { WorkflowAnalyticsService } from '../application/workflow-analytics.service';
import { WorkflowEngine } from '../application/workflow-engine.service';
import { WorkflowService } from '../application/workflow.service';
import { expressionSchema, pageSchema, secretCreateSchema, secretReplaceSchema, testRunSchema, webhookTestSchema, workflowInputSchema } from './workflow.schemas';

const SAMPLE = { first_name: 'สมชาย', last_name: 'ใจดี', email: 'sample@example.com', mobile_phone: '0800000000', custype: 'RESTAURANT', cuisine_name: 'ไทย' };

/** Commerce-run marketing workflows (spec 2026-10-10 §4.8). Static routes before `:id`. */
@Controller('marketing/flows')
@StaffRoles('marketing')
export class MarketingWorkflowController {
  constructor(private readonly flows: WorkflowService, private readonly analytics: WorkflowAnalyticsService, private readonly engine: WorkflowEngine,
    private readonly secrets: WebhookSecretsService, private readonly testers: MarketingTesters) {}

  @Get() list() { return this.flows.list(); }
  @Get('meta') meta() { return this.flows.meta(); }
  @Get('segment-options') segmentOptions() { return this.flows.segmentOptions(); }
  @Post('validate-expression') validateExpression(@Body() b: unknown) {
    const r = checkExpression(parse(expressionSchema, b).expression);
    return 'error' in r ? { ok: false, error: r.error } : { ok: true };
  }
  @Post('webhook-test') async webhookTest(@Body() b: unknown): Promise<WebhookTestResult> {
    const step = parse(webhookTestSchema, b).step as Extract<WorkflowStep, { type: 'webhook' }>;
    const req = renderWebhook(step, webhookVars(SAMPLE, { userId: '00000000-0000-4000-8000-000000000000', workflowId: 'test', workflowName: 'test', enrollmentId: 'test', stepId: step.id }));
    try {
      return await sendWebhook(req, await this.secrets.resolve(secretIdsOf(req.headers))); // body comes back with secrets masked
    } catch (e) {
      const err = e instanceof WebhookSendError ? e : new WebhookSendError('send_failed', false);
      return { status: err.status, body: '', error: err.code };
    }
  }
  @Get('webhook-secrets') listSecrets() { return this.secrets.list(); }
  @Post('webhook-secrets') createSecret(@Body() b: unknown, @Req() r: StaffRequest) { const x = parse(secretCreateSchema, b); return this.secrets.create(x.name, x.value, r.staff.email); }
  @Put('webhook-secrets/:sid') replaceSecret(@Param('sid', ParseUUIDPipe) sid: string, @Body() b: unknown) { return this.secrets.replace(sid, parse(secretReplaceSchema, b).value); }
  @Delete('webhook-secrets/:sid') removeSecret(@Param('sid', ParseUUIDPipe) sid: string) { return this.secrets.remove(sid); }

  @Post() create(@Body() b: unknown, @Req() r: StaffRequest) { return this.flows.create(parse(workflowInputSchema, b) as unknown as WorkflowInput, r.staff.email); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.flows.get(id); }
  @Put(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Req() r: StaffRequest) {
    return this.flows.update(id, parse(workflowInputSchema, b) as unknown as WorkflowInput, r.staff.email);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.flows.remove(id); }
  @Post(':id/activate') activate(@Param('id', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.flows.activate(id, r.staff.email); }
  @Post(':id/pause') pause(@Param('id', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.flows.pause(id, r.staff.email); }
  @Get(':id/revisions') revisions(@Param('id', ParseUUIDPipe) id: string) { return this.flows.revisionsOf(id); }
  @Get(':id/analytics') async stats(@Param('id', ParseUUIDPipe) id: string) { return this.analytics.analytics(id, (await this.flows.row(id)).steps); }
  @Get(':id/enrollments') enrollments(@Param('id', ParseUUIDPipe) id: string, @Query() q: unknown) { return this.analytics.enrollments(id, parse(pageSchema, q).page); }
  @Get(':id/enrollments/:eid/logs') logs(@Param('id', ParseUUIDPipe) id: string, @Param('eid', ParseUUIDPipe) eid: string) { return this.analytics.logs(id, eid); }

  /** Real sends to one tester only (spec §4.8); the flow must be valid. */
  @Post(':id/test-run') async testRun(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const x = parse(testRunSchema, b);
    await this.testers.assert(x.userId);
    const row = await this.flows.row(id);
    const issues = await this.flows.issuesOf(row);
    if (issues.length) throw new UnprocessableEntityException({ message: 'workflow ยังไม่พร้อม', issues });
    return { enrollmentId: await this.engine.enroll(row, x.userId, `test:${Date.now()}`, { test: true, skipWaits: x.skipWaits }) };
  }
}
