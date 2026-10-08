import { Module, UseGuards } from '@nestjs/common';
import { JoshModule } from '../../integration/connector/josh/josh.module';
import { Public } from '../../../shared-kernel/presentation/auth.decorators';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { NotificationService } from './shared/notification.service';
import { BrevoEmailService } from './shared/brevo-email.service';
import { UploadService } from './shared/upload.service';
import { CuisineService } from './shared/cuisine.service';
import { WinbackOwnershipGuard } from './winback-ownership.guard';
import { WinbackMirror } from './winback-mirror';
import { WinbackStaffActions } from './winback-staff-actions';
import { WinbackLoginController } from './winback-login.controller';
import { ApiKeyModule } from '../../core/api-key/api-key.module';
import { StorefrontApiKeyGuard } from '../../../storefront/storefront-api-key.guard';
import { JOSH_COPY_TABLES } from './josh-copies.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { WinbackSalesTarget } from './entities/winback-sales-target.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import { WinbackMeetingAck } from './entities/winback-meeting-ack.entity';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { WinbackController } from './winback.controller';
import { WinbackAppController } from './winback-app.controller';
import { OpportunityService } from './opportunity.service';
import { SignalService } from './signal.service';
import { WinbackCatalogService } from './winback-catalog.service';
import { AppRecordsService } from './app-records.service';
import { CommercialService } from './commercial.service';
import { WinbackService } from './winback.service';
import { SyncService } from './sync.service';
import { ImportService } from './import.service';
import { MatchingService } from './matching.service';
import { LeadService } from './lead.service';
import { ActivityService } from './activity.service';
import { DiaryService } from './diary.service';
import { ReportService } from './report.service';
import { AnalyticsService } from './analytics.service';
import { ContactService } from './contact.service';
import { MeetingPrepService } from './meeting-prep.service';
import { WinbackIntakeController } from './winback-intake.controller';
import { IntakeService } from './intake.service';
import { WinbackNotifyService } from './winback-notify.service';
import { WinbackNotifyCron } from './winback-notify.cron';
import { WinbackReports } from './winback-reports';
import { WinbackReportsController } from './winback-reports.controller';

// The app signs in at josh and sends josh's access token: commerce's staff guard steps aside and
// AdminWriteGuard (josh's checks, on the staff copy) decides. Writes only when commerce owns winback.
for (const c of [WinbackController, WinbackAppController, WinbackIntakeController]) { Public()(c); UseGuards(WinbackOwnershipGuard)(c); }

/**
 * Winback — the sales win-back CRM behind the saleactivity app — run by commerce: josh's module
 * (apps/backend/src/app/winback, copied as is) on commerce's own winback tables. josh's data it
 * reads (users, orders, companies, restaurant places, ERP sales history, cuisine) comes from commerce's
 * copies (josh events / import, stage 2c) — josh's replica is only used by WinbackMirror;
 * notifications and the welcome-lead email are delivered by josh through the outbox.
 */
@Module({
  imports: [
    JoshModule,
    ApiKeyModule,
    TypeOrmModule.forFeature([WinbackAccount, WinbackActivity, WinbackContact, WinbackSalesTarget, WinbackStageHistory, WinbackMeetingAck, WinbackAppRecord, ...JOSH_COPY_TABLES]),
  ],
  controllers: [WinbackController, WinbackAppController, WinbackIntakeController, WinbackLoginController, WinbackReportsController],
  providers: [
    AdminWriteGuard,
    StorefrontApiKeyGuard,
    WinbackOwnershipGuard,
    NotificationService,
    BrevoEmailService,
    UploadService,
    CuisineService,
    WinbackMirror,
    WinbackStaffActions,
    WinbackService,
    SyncService,
    ImportService,
    MatchingService,
    LeadService,
    ActivityService,
    DiaryService,
    ReportService,
    AnalyticsService,
    ContactService,
    MeetingPrepService,
    IntakeService,
    WinbackNotifyService,
    WinbackNotifyCron,
    WinbackReports,
    OpportunityService,
    SignalService,
    WinbackCatalogService,
    AppRecordsService,
    CommercialService,
  ],
  exports: [WinbackService, LeadService, ReportService, WinbackMirror, WinbackStaffActions, WinbackReports],
})
export class WinbackModule {}
