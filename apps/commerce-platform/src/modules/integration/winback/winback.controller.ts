// apps/backend/src/app/winback/winback.controller.ts
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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { readBearerToken } from './shared/bearer-token.util';
import { isSecurityStrictMode } from './shared/security-strict.util';
import { PoolQueryDto } from './dto/pool-query.dto';
import { SyncDto } from './dto/sync.dto';
import { ImportCommitDto } from './dto/import-commit.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import {
  CancelActivityDto,
  CheckinDto,
  CheckoutDto,
  CompleteActivityDto,
  CreateActivityDto,
  RescheduleActivityDto,
} from './dto/create-activity.dto';
import { DiaryQueryDto } from './dto/diary-query.dto';
import { LeadSignalsQueryDto } from './dto/lead-signals-query.dto';
import { CreateMeetingAckDto, MeetingAckQueryDto } from './dto/meeting-ack.dto';
import { WinbackService } from './winback.service';
import { SyncService } from './sync.service';
import { ImportService } from './import.service';
import { LeadService } from './lead.service';
import { ActivityService } from './activity.service';
import { DiaryService } from './diary.service';
import { ReportService } from './report.service';
import { AnalyticsService } from './analytics.service';
import { ContactService } from './contact.service';
import { MeetingPrepService } from './meeting-prep.service';
import { ScorecardQueryDto } from './dto/scorecard-query.dto';
import { MoveStageDto } from './dto/move-stage.dto';
import { UpsertTargetDto } from './dto/upsert-target.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { WinbackActivityType } from './winback.enums';
import { isWinbackManager } from './winback-roles';
import { WinbackResponseInterceptor } from './winback-response.interceptor';
import { UploadMultipleFields } from './shared/ile-upload.interceptor';
import { UploadService } from './shared/upload.service';
import { AppRecordsService } from './app-records.service';

const pipe = new ValidationPipe({ transform: true, whitelist: true });

export interface RequestWithUser {
  user?: { sub?: string; email?: string; role?: string };
  headers?: { authorization?: string };
}

export interface JwtClaims {
  sub: string;
  email: string;
  role: string;
}

/**
 * Dev-only fallback: decode a JWT payload without verifying. In strict mode
 * (prod) AdminWriteGuard has verified the token and set `req.user`, and this
 * never runs; identity must not come from an unverified header there.
 */
export function claimsFromBearer(req: RequestWithUser): JwtClaims {
  if (isSecurityStrictMode()) return { sub: '', email: '', role: '' };
  const token = readBearerToken(req?.headers?.authorization);
  if (!token) return { sub: '', email: '', role: '' };
  const parts = token.split('.');
  if (parts.length < 2) return { sub: '', email: '', role: '' };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    return {
      sub: typeof payload?.sub === 'string' ? payload.sub : '',
      email: typeof payload?.email === 'string' ? payload.email : '',
      role: typeof payload?.role === 'string' ? payload.role : '',
    };
  } catch {
    return { sub: '', email: '', role: '' };
  }
}

function subFromBearer(req: RequestWithUser): string {
  return claimsFromBearer(req).sub;
}

@UseGuards(AdminWriteGuard)
@UseInterceptors(WinbackResponseInterceptor)
@Controller('winback')
export class WinbackController {
  constructor(
    private readonly winback: WinbackService,
    private readonly sync: SyncService,
    private readonly imports: ImportService,
    private readonly leads: LeadService,
    private readonly activityService: ActivityService,
    private readonly diary: DiaryService,
    private readonly reports: ReportService,
    private readonly analytics: AnalyticsService,
    private readonly contactsService: ContactService,
    private readonly meetingPrep: MeetingPrepService,
    private readonly uploads: UploadService,
    private readonly appRecords: AppRecordsService,
  ) {}

  private salesId(req: RequestWithUser): string {
    // In dev, AdminWriteGuard short-circuits without populating req.user, so fall
    // back to decoding the Bearer token (access is already gated by the guard).
    return req?.user?.sub || subFromBearer(req);
  }

  private claims(req: RequestWithUser): JwtClaims {
    const fromToken = claimsFromBearer(req);
    return {
      sub: req?.user?.sub || fromToken.sub,
      email: req?.user?.email || fromToken.email,
      role: req?.user?.role || fromToken.role,
    };
  }

  /** ดึงข้อมูล claims ของผู้ใช้ที่ login อยู่ (role/email) */
  @Get('me')
  me(@Req() req: RequestWithUser) {
    const c = this.claims(req);
    return {
      salesUserId: c.sub,
      email: c.email,
      role: c.role || 'sale',
      isManager: isWinbackManager(c.role),
    };
  }

  /** Assignable sales/staff for manager assign UI. */
  @Get('sales-users')
  salesUsers(@Req() req: RequestWithUser, @Query('search') search?: string) {
    const c = this.claims(req);
    if (!isWinbackManager(c.role)) {
      throw new ForbiddenException('เฉพาะ manager ที่ดูรายชื่อเซลล์ได้');
    }
    return this.leads.listSalesUsers(search);
  }

  /** Per-rep lead counts + KPIs (manager team analytics). */
  @Get('team-stats')
  teamStats(
    @Req() req: RequestWithUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const c = this.claims(req);
    if (!isWinbackManager(c.role)) {
      throw new ForbiddenException('เฉพาะ manager ที่ดูสถิติทีมได้');
    }
    return this.reports.getTeamStats(from, to);
  }

  /** ดึงตำแหน่ง location ของทีมเซลล์ (manager เห็นทั้งทีม) */
  @Get('team-locations')
  teamLocations(
    @Req() req: RequestWithUser,
    @Query(pipe) q: AnalyticsQueryDto,
  ) {
    const c = this.claims(req);
    const isManager = isWinbackManager(c.role);
    return this.analytics.getTeamLocations(
      {
        id: c.sub,
        isManager,
      },
      isManager ? q.sales_user_id : undefined,
    );
  }

  /** ดึง feed กิจกรรมล่าสุดของทีมเซลล์ */
  @Get('team-activity-feed')
  teamActivityFeed(
    @Req() req: RequestWithUser,
    @Query(pipe) q: AnalyticsQueryDto,
  ) {
    const c = this.claims(req);
    return this.analytics.getTeamActivityFeed(
      { id: c.sub, isManager: isWinbackManager(c.role) },
      q.from,
      q.to,
      q.sales_user_id,
    );
  }

  /** ดึงข้อมูล analytics ของ winback ตามช่วงวันที่และ scope */
  @Get('analytics')
  getAnalytics(
    @Req() req: RequestWithUser,
    @Query(pipe) q: AnalyticsQueryDto,
  ) {
    const c = this.claims(req);
    const isManager = isWinbackManager(c.role);
    const scope = isManager ? (q.scope ?? 'team') : 'me';
    return this.analytics.getAnalytics(
      scope,
      c.sub,
      q.from,
      q.to,
      isManager ? q.sales_user_id : undefined,
    );
  }

  /** ดึงเป้าหมายยอดขาย (target) ของเดือนที่ระบุ */
  @Get('targets')
  targets(
    @Req() req: RequestWithUser,
    @Query('period_month') periodMonth: string,
  ) {
    const c = this.claims(req);
    return this.analytics.listTargets(periodMonth, {
      id: c.sub,
      isManager: isWinbackManager(c.role),
    });
  }

  /** สร้างหรือแก้ไขเป้าหมายยอดขายของเซลล์/ทีม */
  @Put('targets')
  upsertTarget(
    @Req() req: RequestWithUser,
    @Body(pipe) dto: UpsertTargetDto,
  ) {
    const c = this.claims(req);
    return this.analytics.upsertTarget(
      dto,
      c.sub,
      isWinbackManager(c.role),
    );
  }

  /** ดึงรายชื่อ lead ที่ค้างไม่ได้ติดต่อเกิน N วัน */
  @Get('aging')
  aging(@Req() req: RequestWithUser, @Query('days') days?: string) {
    const c = this.claims(req);
    if (!isWinbackManager(c.role)) {
      // Sales: aging only for their own unworked leads
      return this.winback.getAging(Number(days) || 3).then((rows) =>
        rows.filter(
          (r) => r.assigned_sales_user_id === c.sub || !r.assigned_sales_user_id,
        ),
      );
    }
    return this.winback.getAging(Number(days) || 3);
  }

  /**
   * Facts behind the Monday meeting-prep screen: stage timing, last activity and
   * overdue appointments per lead, plus the team's median days per stage.
   *
   * Returns facts, not talking points — the app owns the wording and the ranking.
   * Scope matches `/aging`: a manager sees the team, a sales user sees their own
   * leads plus unassigned ones.
   */
  @ApiOperation({ summary: 'Lead facts for the meeting-prep screen' })
  @Get('lead-signals')
  leadSignals(@Req() req: RequestWithUser, @Query(pipe) q: LeadSignalsQueryDto) {
    const c = this.claims(req);
    return this.meetingPrep.getLeadSignals(
      {
        salesUserId: this.salesId(req),
        isManager: isWinbackManager(c.role),
        requestedSalesUserId: q.sales_user_id,
      },
      q.limit,
    );
  }

  /** Talking points already raised at a meeting (default: the last 8 weeks). */
  @Get('meeting-prep/acknowledgements')
  meetingAcknowledgements(
    @Req() req: RequestWithUser,
    @Query(pipe) q: MeetingAckQueryDto,
  ) {
    const c = this.claims(req);
    return this.meetingPrep.listAcknowledgements(
      { salesUserId: this.salesId(req), isManager: isWinbackManager(c.role) },
      q.since,
    );
  }

  /** Mark a talking point as discussed. Identity is account + signal + subject. */
  @Post('meeting-prep/acknowledgements')
  acknowledgeMeetingPoint(
    @Req() req: RequestWithUser,
    @Body(pipe) dto: CreateMeetingAckDto,
  ) {
    return this.meetingPrep.acknowledge(dto, this.salesId(req));
  }

  /** ดึงรายชื่อ lead ใน pool ตามเงื่อนไข query */
  /** ดึงรายชื่อจังหวัดที่มีอยู่จริงใน pool พร้อมจำนวน (สำหรับ dropdown ตัวกรอง) */
  @Get('provinces')
  provinces() {
    return this.winback.listProvinces();
  }

  @Get('pool')
  pool(@Query(pipe) q: PoolQueryDto) {
    return this.winback.findPool(q);
  }

  /** ดึงจำนวน lead แยกตามสถานะใน pool (+ `mine` = ที่ assign ให้ผู้เรียก) */
  @Get('pool/counts')
  counts(@Req() req: RequestWithUser) {
    return this.winback.getCounts(this.salesId(req));
  }

  /** ดึงข้อมูลบัญชี lead ตาม id */
  @Get('account/:id')
  account(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.winback.getAccount(id);
  }

  /** สั่ง sync ข้อมูล winback จาก Josh ย้อนหลัง N วัน — แต่ละรอบถูกบันทึกไว้ (`GET /sync/runs`), `runId` = รอบนี้ */
  @Post('sync')
  async runSync(@Req() req: RequestWithUser, @Body(pipe) dto: SyncDto) {
    const c = this.claims(req);
    const startedAt = new Date();
    const result = await this.sync.syncFromJosh(dto.days);
    const run = await this.appRecords.recordSyncRun(
      { id: c.sub, isManager: isWinbackManager(c.role) },
      dto.days,
      result as unknown as Record<string, unknown>,
      startedAt,
    );
    return { ...result, run_id: run.id };
  }

  /** พรีวิวไฟล์ CSV ที่อัปโหลดก่อน commit นำเข้า lead */
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(@UploadedFile() file?: { buffer: Buffer }) {
    if (!file) throw new BadRequestException('file is required');
    return this.imports.preview(file.buffer.toString('utf-8'));
  }

  @ApiOperation({ summary: 'Upload activity checkout photo; returns { url }' })
  @Post('upload/activity-photo')
  @UploadMultipleFields([{ name: 'file', maxCount: 1 }], './uploads/activities', 5)
  async uploadActivityPhoto(
    @UploadedFiles() files: { file?: Express.Multer.File[] },
  ) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException('file is required');
    const { url } = await this.uploads.uploadActivityPhoto(file);
    return { url };
  }

  /** นำเข้า lead จากแถวที่ผ่านการพรีวิวแล้วเข้าระบบจริง */
  @Post('import/commit')
  commitImport(@Body(pipe) dto: ImportCommitDto) {
    return this.imports.commit(dto.rows);
  }

  // --- Sales diary (P2) ---

  @ApiOperation({
    summary:
      'สร้าง lead ใหม่ พร้อมบันทึก note เป็น activity แรกถ้ามี (response ห่อ { data } camelCase เหมือนเส้นอื่น)',
  })
  @Post('leads')
  async createLead(@Req() req: RequestWithUser, @Body(pipe) dto: CreateLeadDto) {
    const salesId = this.salesId(req);
    const lead = await this.leads.create(salesId, dto);
    if (dto.note) {
      await this.activityService.log(lead.id, salesId, {
        type: WinbackActivityType.NOTE,
        note: dto.note,
      });
    }
    return lead;
  }

  /** สร้าง TMP lead จาก Market Explorer restaurant_place (pre-fill ชื่อ/พิกัด/ประเภท) */
  @Post('leads/from-restaurant-place/:placeId')
  createTmpFromRestaurantPlace(
    @Req() req: RequestWithUser,
    @Param('placeId', new ParseUUIDPipe()) placeId: string,
  ) {
    return this.leads.createTmpFromRestaurantPlace(this.salesId(req), placeId);
  }

  /** บันทึก activity ใหม่ให้บัญชี lead ตาม id */
  @Post('account/:id/activities')
  logActivity(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe) dto: CreateActivityDto,
  ) {
    return this.activityService.log(id, this.salesId(req), dto);
  }

  /** ดึงประวัติ activity ทั้งหมดของบัญชี lead ตาม id */
  @Get('account/:id/activities')
  listActivities(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.activityService.list(id);
  }

  /** ดึงตารางงานวันนี้ของเซลล์ (diary) */
  @Get('my-day')
  myDay(@Req() req: RequestWithUser, @Query(pipe) q: DiaryQueryDto) {
    return this.diary.getMyDay(q.sales_user_id || this.salesId(req), q.date);
  }

  /** ดึง diary กิจกรรมของเซลล์ตามช่วงวันที่ */
  @Get('diary')
  getDiary(@Req() req: RequestWithUser, @Query(pipe) q: DiaryQueryDto) {
    return this.diary.getDiary(q.sales_user_id || this.salesId(req), q.from, q.to);
  }

  /** Planned appointments by scheduled_at range (calendar). */
  @Get('calendar')
  getCalendar(@Req() req: RequestWithUser, @Query(pipe) q: DiaryQueryDto) {
    return this.diary.getCalendar(q.sales_user_id || this.salesId(req), q.from, q.to);
  }

  /** ดึง scorecard ผลงานเซลล์/ทีมตามช่วงวันที่ */
  @Get('scorecard')
  scorecard(@Req() req: RequestWithUser, @Query(pipe) q: ScorecardQueryDto) {
    const c = this.claims(req);
    const scope = isWinbackManager(c.role) ? (q.scope ?? 'team') : 'me';
    return this.reports.getScorecard(scope, this.salesId(req), q.from, q.to);
  }

  /** Sales KPI dashboard: GMV / target gap / AOV / customer segments / by-person. */
  @Get('dashboard')
  dashboard(@Req() req: RequestWithUser, @Query(pipe) q: ScorecardQueryDto) {
    const c = this.claims(req);
    const scope = isWinbackManager(c.role) ? (q.scope ?? 'team') : 'me';
    return this.reports.getDashboard(scope, this.salesId(req), q.from, q.to);
  }

  /** ย้าย stage ของ lead พร้อมเหตุผล/note ถ้ามี */
  @Patch('account/:id/stage')
  moveStage(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe) dto: MoveStageDto,
  ) {
    return this.activityService.moveStage(id, this.salesId(req), dto.stage, {
      note: dto.note,
      rejectReason: dto.reject_reason,
      rejectNote: dto.reject_note,
    });
  }

  // --- Pipeline v1: lead edit, contacts, appointment complete ---

  @ApiOperation({ summary: 'แก้ไขข้อมูล lead ตาม id' })
  @Patch('account/:id')
  updateLead(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe) dto: UpdateLeadDto,
  ) {
    const c = this.claims(req);
    return this.leads.update(id, dto, { salesUserId: c.sub, role: c.role });
  }

  /** Manual promote TMP → Lead (ยืนยันสมัครแอปแล้ว). */
  @Patch('account/:id/promote')
  promoteLead(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.leads.promoteToLead(id);
  }

  /** ดึงรายชื่อผู้ติดต่อของบัญชี lead ตาม id */
  @Get('account/:id/contacts')
  listContacts(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.contactsService.list(id);
  }

  /** เพิ่มผู้ติดต่อใหม่ให้บัญชี lead ตาม id */
  @Post('account/:id/contacts')
  addContact(@Param('id', new ParseUUIDPipe()) id: string, @Body(pipe) dto: CreateContactDto) {
    return this.contactsService.add(id, dto);
  }

  /** แก้ไขข้อมูลผู้ติดต่อตาม contactId */
  @Patch('contacts/:contactId')
  updateContact(@Param('contactId', new ParseUUIDPipe()) contactId: string, @Body(pipe) dto: UpdateContactDto) {
    return this.contactsService.update(contactId, dto);
  }

  /** ลบผู้ติดต่อตาม contactId */
  @Delete('contacts/:contactId')
  removeContact(@Param('contactId', new ParseUUIDPipe()) contactId: string) {
    return this.contactsService.remove(contactId);
  }

  /** ปิดงาน (complete) activity ตาม activityId */
  @Patch('activities/:activityId/complete')
  completeActivity(
    @Req() req: RequestWithUser,
    @Param('activityId', new ParseUUIDPipe()) activityId: string,
    @Body(pipe) dto: CompleteActivityDto,
  ) {
    return this.activityService.complete(activityId, this.salesId(req), dto);
  }

  /** เลื่อนนัดหมายที่ยังไม่เกิดขึ้น (status = planned) ไปวัน/เวลาใหม่ */
  @Patch('activities/:activityId/reschedule')
  rescheduleActivity(
    @Param('activityId', new ParseUUIDPipe()) activityId: string,
    @Body(pipe) dto: RescheduleActivityDto,
  ) {
    return this.activityService.reschedule(activityId, dto);
  }

  /** ยกเลิกนัดหมายที่ยังไม่เกิดขึ้น (status = planned) */
  @Patch('activities/:activityId/cancel')
  cancelActivity(
    @Param('activityId', new ParseUUIDPipe()) activityId: string,
    @Body(pipe) dto: CancelActivityDto,
  ) {
    return this.activityService.cancel(activityId, dto);
  }

  /** เช็คอินเข้าเยี่ยมลูกค้าที่บัญชี lead ตาม id */
  @Post('account/:id/checkin')
  checkin(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(pipe) dto: CheckinDto,
  ) {
    return this.activityService.checkin(id, this.salesId(req), dto);
  }

  /** เช็คเอาท์กิจกรรมที่เช็คอินไว้ตาม activityId */
  @Patch('activities/:activityId/checkout')
  checkout(
    @Param('activityId', new ParseUUIDPipe()) activityId: string,
    @Body(pipe) dto: CheckoutDto,
  ) {
    return this.activityService.checkout(activityId, dto);
  }
}
