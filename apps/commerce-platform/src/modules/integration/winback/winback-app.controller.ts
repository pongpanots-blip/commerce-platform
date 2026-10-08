// The saleactivity screens that had no API: opportunities, revenue signals, product catalog, visit /
// appointment extras, drafts, coaching, teams, work plan / saved places / discovery, sync history and the
// record-only commercial screens. Same path, DTOs and response shape on josh and commerce (only imports and
// module wiring differ), so the app works through josh nginx `/api/winback/*` before and after cutover.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { WinbackAppRoleGuard } from './winback-app-role.guard';
import { claimsFromBearer, RequestWithUser } from './winback.controller';
import { isWinbackManager } from './winback-roles';
import { WinbackResponseInterceptor } from './winback-response.interceptor';
import { OpportunityService } from './opportunity.service';
import { OpportunityCollabService } from './opportunity-collab.service';
import { SignalService } from './signal.service';
import { WinbackCatalogService } from './winback-catalog.service';
import { AppRecordsService, SYNC_SOURCES, WinbackActor } from './app-records.service';
import { CommercialService } from './commercial.service';
import {
  ActivityDraftDto,
  AppointmentPlanDto,
  CoachingTaskQueryDto,
  CollabLogPageDto,
  CollabLogQueryDto,
  CollabMessageDto,
  CreateCollabRequestDto,
  CompleteSignalDto,
  CreateCoachingTaskDto,
  DailyReportQueryDto,
  DiscoveryQueryDto,
  DismissSignalDto,
  InvoiceEvidenceQueryDto,
  JointVisitDto,
  MoveQuoteDto,
  OpportunityProvinceQueryDto,
  OpportunityQueryDto,
  ProductQueryDto,
  QuoteDispatchDto,
  QuoteFollowUpDto,
  QuoteQueryDto,
  QuoteTermsCatalogDto,
  ResolveCollabRequestDto,
  ReviewDailyReportDto,
  SaveDailyReportDto,
  SaveQuoteDto,
  SignalQueryDto,
  SnoozeSignalDto,
  SubmitDailyReportDto,
  SyncRunQueryDto,
  TeamDto,
  UpdateCoachingTaskDto,
  UpdateOpportunityMetaDto,
  VisitCompletionDto,
  VisitStartEvidenceDto,
  WorkPlanDto,
  WorkPlanQueryDto,
} from './dto/app-gaps.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const COLLAB_LOG_MANAGER_ONLY = 'เฉพาะ manager ที่ดูบันทึกการประสานงานได้';
const uuid = () => new ParseUUIDPipe();

/** A draft key is an account id or `standalone`. */
function draftKey(raw: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(raw)) throw new BadRequestException('draft key must be an account id or "standalone"');
  return raw;
}

function reportDay(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) throw new BadRequestException('day must be YYYY-MM-DD');
  return raw;
}

@UseGuards(AdminWriteGuard, WinbackAppRoleGuard)
@UseInterceptors(WinbackResponseInterceptor)
@Controller('winback')
export class WinbackAppController {
  constructor(
    private readonly opportunities: OpportunityService,
    private readonly signals: SignalService,
    private readonly catalog: WinbackCatalogService,
    private readonly records: AppRecordsService,
    private readonly commercial: CommercialService,
    private readonly collab: OpportunityCollabService,
  ) {}

  private actor(req: RequestWithUser): WinbackActor {
    const fromToken = claimsFromBearer(req);
    return {
      id: req?.user?.sub || fromToken.sub,
      isManager: isWinbackManager(req?.user?.role || fromToken.role),
    };
  }

  private manager(req: RequestWithUser, message: string): WinbackActor {
    const actor = this.actor(req);
    if (!actor.isManager) throw new ForbiddenException(message);
    return actor;
  }

  // --- Opportunities (Market Explorer places with no lead yet) ---

  @ApiOperation({ summary: 'โอกาสการขาย: ร้านใน Market Explorer ที่ยังไม่มี lead — { items (+ meta), pagination, counts }' })
  @Get('opportunities')
  listOpportunities(@Req() req: RequestWithUser, @Query(pipe) q: OpportunityQueryDto) {
    return this.opportunities.list(this.actor(req), q);
  }

  @Get('opportunities/provinces')
  opportunityProvinces(@Req() req: RequestWithUser, @Query(pipe) q: OpportunityProvinceQueryDto) {
    return this.opportunities.provinces(this.actor(req), q);
  }

  /** นับตาม stage / purpose / recommendation / owner ร้านที่ยังไม่มี lead ที่ผู้เรียกมองเห็น (scope เดียวกับ list) — owners ของ sale = ตัวเองเท่านั้น */
  @Get('opportunities/filter-meta')
  opportunityFilterMeta(@Req() req: RequestWithUser) {
    return this.opportunities.filterMeta(this.actor(req));
  }

  /** 403 on another rep's opportunity (same rule as its meta / thread — §4.11.8 visibility) */
  @Get('opportunities/:id')
  opportunity(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.collab.detail(this.actor(req), id);
  }

  /** สร้าง TMP lead เฉพาะโอกาสที่เห็น thread ได้ (idempotent — แปลงแล้วคืน lead เดิม) */
  @Post('opportunities/:id/convert')
  convertOpportunity(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.opportunities.convert(this.actor(req), id);
  }

  // --- Opportunity filter metadata + collaboration (§4.11.8, record-only: nothing is sent or reassigned) ---
  // Visibility: manager = every opportunity; anyone else = own + unassigned (+ reading / messaging / resolving
  // on a thread where a request is addressed to them) — 403 `โอกาสนี้มีผู้ดูแลคนอื่น …` otherwise.

  @Get('opportunities/:id/meta')
  opportunityMeta(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.collab.meta(this.actor(req), id);
  }

  @Patch('opportunities/:id/meta')
  updateOpportunityMeta(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: UpdateOpportunityMetaDto) {
    return this.collab.updateMeta(this.actor(req), id, dto);
  }

  @Get('opportunities/:id/collaboration')
  opportunityCollaboration(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.collab.collaboration(this.actor(req), id);
  }

  @Post('opportunities/:id/collaboration')
  createCollabRequest(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: CreateCollabRequestDto) {
    return this.collab.createRequest(this.actor(req), id, dto);
  }

  /** บันทึกการประสานงานของโอกาสนี้ (manager เท่านั้น) — `{ data, meta: { page, limit, total } }` ใหม่→เก่า */
  @Get('opportunities/:id/collaboration/logs')
  opportunityCollaborationLogs(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Query(pipe) q: CollabLogPageDto) {
    this.manager(req, COLLAB_LOG_MANAGER_ONLY);
    return this.collab.opportunityLogs(id, q);
  }

  @Post('opportunities/:id/collaboration/messages')
  postCollabMessage(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: CollabMessageDto) {
    return this.collab.postMessage(this.actor(req), id, dto);
  }

  @Patch('opportunities/:id/collaboration/:requestId')
  resolveCollabRequest(
    @Req() req: RequestWithUser,
    @Param('id', uuid()) id: string,
    @Param('requestId', uuid()) requestId: string,
    @Body(pipe) dto: ResolveCollabRequestDto,
  ) {
    return this.collab.resolveRequest(this.actor(req), id, requestId, dto);
  }

  /** place id ที่แปลงเป็น account นี้ — เฉพาะที่ผู้เรียกมองเห็น (ของตัวเอง / ยังไม่มีผู้ดูแล; manager ทั้งหมด) */
  @Get('account/:id/opportunities')
  accountOpportunities(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.opportunities.accountOpportunities(this.actor(req), id);
  }

  /** รายชื่อเซลล์ให้เลือกผู้รับคำขอ/ข้อความ — `{ id, name }` เท่านั้น (ไม่มี email/phone/role) · sale ดู `/sales-users` ไม่ได้ */
  @Get('collaboration/directory')
  collaborationDirectory() {
    return this.collab.directory();
  }

  /** บันทึกการประสานงานทุกโอกาส (manager เท่านั้น, append-only) — กรอง opportunity / actor / target / user / event / ช่วงวัน */
  @Get('collaboration/logs')
  collaborationLogs(@Req() req: RequestWithUser, @Query(pipe) q: CollabLogQueryDto) {
    this.manager(req, COLLAB_LOG_MANAGER_ONLY);
    return this.collab.logs(q);
  }

  // --- Revenue signals (id = account id) ---

  @Get('signals')
  listSignals(@Req() req: RequestWithUser, @Query(pipe) q: SignalQueryDto) {
    return this.signals.list(this.actor(req), q);
  }

  @Post('signals/:id/complete')
  completeSignal(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: CompleteSignalDto) {
    return this.signals.complete(this.actor(req), id, dto);
  }

  @Post('signals/:id/snooze')
  snoozeSignal(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: SnoozeSignalDto) {
    return this.signals.snooze(this.actor(req), id, dto);
  }

  @Post('signals/:id/dismiss')
  dismissSignal(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: DismissSignalDto) {
    return this.signals.dismiss(this.actor(req), id, dto);
  }

  @Get('account/:id/revenue-context')
  revenueContext(@Param('id', uuid()) id: string) {
    return this.signals.revenueContext(id);
  }

  // --- Product catalog ---

  @Get('products')
  products(@Query(pipe) q: ProductQueryDto) {
    return this.catalog.listProducts({ search: q.search, limit: q.limit });
  }

  // --- Appointment plan / visit completion / start evidence / joint visits ---

  @Get('activities/:activityId/plan')
  appointmentPlan(@Param('activityId', uuid()) activityId: string) {
    return this.records.getAppointmentPlan(activityId);
  }

  @Put('activities/:activityId/plan')
  saveAppointmentPlan(
    @Req() req: RequestWithUser,
    @Param('activityId', uuid()) activityId: string,
    @Body(pipe) dto: AppointmentPlanDto,
  ) {
    return this.records.saveAppointmentPlan(this.actor(req), activityId, dto);
  }

  @Get('activities/:activityId/completion')
  visitCompletion(@Param('activityId', uuid()) activityId: string) {
    return this.records.getVisitCompletion(activityId);
  }

  @Put('activities/:activityId/completion')
  saveVisitCompletion(
    @Req() req: RequestWithUser,
    @Param('activityId', uuid()) activityId: string,
    @Body(pipe) dto: VisitCompletionDto,
  ) {
    return this.records.saveVisitCompletion(this.actor(req), activityId, dto);
  }

  @Get('activities/:activityId/start-evidence')
  startEvidence(@Param('activityId', uuid()) activityId: string) {
    return this.records.getStartEvidence(activityId);
  }

  @Put('activities/:activityId/start-evidence')
  saveStartEvidence(
    @Req() req: RequestWithUser,
    @Param('activityId', uuid()) activityId: string,
    @Body(pipe) dto: VisitStartEvidenceDto,
  ) {
    return this.records.saveStartEvidence(this.actor(req), activityId, dto);
  }

  @Get('account/:id/joint-visits')
  jointVisits(@Param('id', uuid()) id: string) {
    return this.records.listJointVisits(id);
  }

  @Put('activities/:activityId/joint-visit')
  saveJointVisit(
    @Req() req: RequestWithUser,
    @Param('activityId', uuid()) activityId: string,
    @Body(pipe) dto: JointVisitDto,
  ) {
    return this.records.saveJointVisit(this.manager(req, 'เฉพาะ manager ที่นัดเยี่ยมร่วมได้'), activityId, dto);
  }

  // --- Activity drafts (per user) ---

  @Get('activity-drafts/:key')
  activityDraft(@Req() req: RequestWithUser, @Param('key') key: string) {
    return this.records.getDraft(this.actor(req), draftKey(key));
  }

  @Put('activity-drafts/:key')
  saveActivityDraft(@Req() req: RequestWithUser, @Param('key') key: string, @Body(pipe) dto: ActivityDraftDto) {
    return this.records.saveDraft(this.actor(req), draftKey(key), dto);
  }

  @Delete('activity-drafts/:key')
  deleteActivityDraft(@Req() req: RequestWithUser, @Param('key') key: string) {
    return this.records.deleteDraft(this.actor(req), draftKey(key));
  }

  // --- Coaching tasks ---

  @Get('coaching-tasks')
  coachingTasks(@Req() req: RequestWithUser, @Query(pipe) q: CoachingTaskQueryDto) {
    return this.records.listCoachingTasks(this.actor(req), q);
  }

  @Post('coaching-tasks')
  createCoachingTask(@Req() req: RequestWithUser, @Body(pipe) dto: CreateCoachingTaskDto) {
    return this.records.createCoachingTask(this.manager(req, 'เฉพาะ manager ที่สร้างงานโค้ชได้'), dto);
  }

  @Patch('coaching-tasks/:id')
  updateCoachingTask(
    @Req() req: RequestWithUser,
    @Param('id', uuid()) id: string,
    @Body(pipe) dto: UpdateCoachingTaskDto,
  ) {
    return this.records.updateCoachingTask(this.actor(req), id, dto);
  }

  // --- Teams (pipeline grouping, manager) ---

  @Get('teams')
  teams(@Req() req: RequestWithUser) {
    this.manager(req, 'เฉพาะ manager ที่ดูทีมได้');
    return this.records.listTeams();
  }

  @Post('teams')
  createTeam(@Req() req: RequestWithUser, @Body(pipe) dto: TeamDto) {
    return this.records.saveTeam(this.manager(req, 'เฉพาะ manager ที่จัดทีมได้'), null, dto);
  }

  @Put('teams/:id')
  updateTeam(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: TeamDto) {
    return this.records.saveTeam(this.manager(req, 'เฉพาะ manager ที่จัดทีมได้'), id, dto);
  }

  @Delete('teams/:id')
  deleteTeam(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.records.deleteTeam(this.manager(req, 'เฉพาะ manager ที่จัดทีมได้'), id);
  }

  // --- Work plan / saved places / discovery query ---

  @Get('work-plans')
  workPlans(@Query(pipe) q: WorkPlanQueryDto) {
    return this.records.listWorkPlans(q.account_ids);
  }

  @Get('account/:id/work-plan')
  workPlan(@Param('id', uuid()) id: string) {
    return this.records.getWorkPlan(id);
  }

  @Put('account/:id/work-plan')
  saveWorkPlan(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: WorkPlanDto) {
    return this.records.saveWorkPlan(this.actor(req), id, dto);
  }

  @Get('saved-places')
  savedPlaces(@Req() req: RequestWithUser) {
    return this.records.listSavedPlaces(this.actor(req));
  }

  @Put('saved-places/:placeId')
  savePlace(@Req() req: RequestWithUser, @Param('placeId', uuid()) placeId: string) {
    return this.records.setSavedPlace(this.actor(req), placeId, true);
  }

  @Delete('saved-places/:placeId')
  unsavePlace(@Req() req: RequestWithUser, @Param('placeId', uuid()) placeId: string) {
    return this.records.setSavedPlace(this.actor(req), placeId, false);
  }

  @Get('discovery-query')
  discoveryQuery(@Req() req: RequestWithUser) {
    return this.records.getDiscoveryQuery(this.actor(req));
  }

  @Put('discovery-query')
  saveDiscoveryQuery(@Req() req: RequestWithUser, @Body(pipe) dto: DiscoveryQueryDto) {
    return this.records.saveDiscoveryQuery(this.actor(req), dto);
  }

  // --- Sync history (POST /sync records each run) ---

  @Get('sync/sources')
  syncSources() {
    return SYNC_SOURCES;
  }

  @Get('sync/runs')
  syncRuns(@Req() req: RequestWithUser, @Query(pipe) q: SyncRunQueryDto) {
    this.manager(req, 'เฉพาะ manager ที่ดูประวัติการ sync ได้');
    return this.records.listSyncRuns(q.limit);
  }

  // --- Commercial (record-only: nothing is sent, no order is created) ---

  @Get('quotes')
  quotes(@Req() req: RequestWithUser, @Query(pipe) q: QuoteQueryDto) {
    return this.commercial.listQuotes(this.actor(req), q);
  }

  @Post('quotes')
  createQuote(@Req() req: RequestWithUser, @Body(pipe) dto: SaveQuoteDto) {
    return this.commercial.saveQuote(this.actor(req), null, dto);
  }

  @Get('quotes/:id')
  quote(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.commercial.getQuote(this.actor(req), id);
  }

  @Put('quotes/:id')
  reviseQuote(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: SaveQuoteDto) {
    return this.commercial.saveQuote(this.actor(req), id, dto);
  }

  @Post('quotes/:id/status')
  moveQuote(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: MoveQuoteDto) {
    return this.commercial.moveQuote(this.actor(req), id, dto);
  }

  @Post('quotes/:id/follow-up')
  followUpQuote(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: QuoteFollowUpDto) {
    return this.commercial.followUpQuote(this.actor(req), id, dto);
  }

  @Get('quotes/:id/dispatches')
  quoteDispatches(@Req() req: RequestWithUser, @Param('id', uuid()) id: string) {
    return this.commercial.listDispatches(this.actor(req), id);
  }

  /** บันทึกว่าเซลล์ส่งใบเสนอราคาแล้ว (record only — ระบบไม่ส่งอีเมล/LINE/SMS) */
  @Post('quotes/:id/dispatches')
  recordQuoteDispatch(@Req() req: RequestWithUser, @Param('id', uuid()) id: string, @Body(pipe) dto: QuoteDispatchDto) {
    return this.commercial.recordDispatch(this.actor(req), id, dto);
  }

  @Get('quote-terms')
  quoteTerms() {
    return this.commercial.getTermsCatalog();
  }

  @Put('quote-terms')
  saveQuoteTerms(@Req() req: RequestWithUser, @Body(pipe) dto: QuoteTermsCatalogDto) {
    return this.commercial.saveTermsCatalog(this.manager(req, 'เฉพาะ manager ที่ตั้งเงื่อนไขใบเสนอราคาได้'), dto);
  }

  @Get('daily-reports')
  dailyReports(@Req() req: RequestWithUser, @Query(pipe) q: DailyReportQueryDto) {
    return this.commercial.listReports(this.actor(req), q);
  }

  @Get('daily-reports/:salesUserId/:day')
  dailyReport(
    @Req() req: RequestWithUser,
    @Param('salesUserId', uuid()) salesUserId: string,
    @Param('day') day: string,
  ) {
    return this.commercial.getReport(this.actor(req), salesUserId, reportDay(day));
  }

  @Put('daily-reports/:salesUserId/:day')
  saveDailyReport(
    @Req() req: RequestWithUser,
    @Param('salesUserId', uuid()) salesUserId: string,
    @Param('day') day: string,
    @Body(pipe) dto: SaveDailyReportDto,
  ) {
    return this.commercial.saveReport(this.actor(req), salesUserId, reportDay(day), dto);
  }

  @Post('daily-reports/:salesUserId/:day/submit')
  submitDailyReport(
    @Req() req: RequestWithUser,
    @Param('salesUserId', uuid()) salesUserId: string,
    @Param('day') day: string,
    @Body(pipe) dto: SubmitDailyReportDto,
  ) {
    return this.commercial.submitReport(this.actor(req), salesUserId, reportDay(day), dto);
  }

  @Post('daily-reports/:salesUserId/:day/review')
  reviewDailyReport(
    @Req() req: RequestWithUser,
    @Param('salesUserId', uuid()) salesUserId: string,
    @Param('day') day: string,
    @Body(pipe) dto: ReviewDailyReportDto,
  ) {
    return this.commercial.reviewReport(
      this.manager(req, 'เฉพาะ manager ที่ตรวจรายงานได้'),
      salesUserId,
      reportDay(day),
      dto,
    );
  }

  @Get('invoices')
  invoices(@Req() req: RequestWithUser, @Query(pipe) q: InvoiceEvidenceQueryDto) {
    return this.commercial.invoiceEvidence(this.actor(req), q);
  }
}
