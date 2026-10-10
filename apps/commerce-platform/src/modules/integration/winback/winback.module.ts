import { SalesWorkController, MarketingReadinessController } from '../commercial-work/commercial-planning.controller';
import { CommercialSourcesService } from '../commercial-work/commercial-sources.service';
import { CommercialDraftsService } from '../commercial-work/commercial-drafts.service';
import { GoalPlanningController } from '../financial-goals/goal-planning.controller';
import { GoalInputsService } from '../financial-goals/goal-inputs.service';
import { GoalDraftsService } from '../financial-goals/goal-drafts.service';
import { WinbackStaffIdentityService } from './shared/winback-staff-identity.service';
import { AuthModule } from '../../core/auth/auth.module';
import { Module, UseGuards } from '@nestjs/common';
import { JoshModule } from '../../integration/connector/josh/josh.module';
import { Public } from '../../../shared-kernel/presentation/auth.decorators';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { WinbackAppRoleGuard } from './winback-app-role.guard';
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
import { WinbackRestaurantPlaceController } from './winback-restaurant-place.controller';
import { OpportunityService } from './opportunity.service';
import { OpportunityCollabService } from './opportunity-collab.service';
import { SignalService } from './signal.service';
import { WinbackCatalogService } from './winback-catalog.service';
import { AppRecordsService } from './app-records.service';
import { CommercialService } from './commercial.service';
import { WinbackService } from './winback.service';
import { SyncService } from './sync.service';
import { ImportService } from './import.service';
import { JoshMatchLookup, MatchingService } from './matching.service';
import { JoshMatchService } from './josh-match.service';
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

// Commerce staff sign-in first, with optional legacy Josh fallback: the global staff guard steps aside
// and AdminWriteGuard verifies both sources. Writes only when commerce owns winback.
// UseGuards appends class metadata: on the app, auth → sales role gate → ownership. Admin callers use
// WinbackController / reports; relays carry the sales user's Josh JWT, and crons call services directly.
for (const c of [WinbackController, WinbackAppController, WinbackRestaurantPlaceController, WinbackIntakeController]) { Public()(c); UseGuards(WinbackOwnershipGuard)(c); }

/**
 * Winback — the sales win-back CRM behind the saleactivity app — run by commerce: josh's module
 * (apps/backend/src/app/winback, copied as is) on commerce's own winback tables. josh's data it
 * reads (users, orders, companies, restaurant places, ERP sales history, cuisine) comes from commerce's
 * copies (josh events / import, stage 2c) — josh's replica is only used by WinbackMirror;
 * notifications and the welcome-lead email are delivered by josh through the outbox.
 */
@Module({
  imports: [AuthModule,
    JoshModule,
    ApiKeyModule,
    TypeOrmModule.forFeature([WinbackAccount, WinbackActivity, WinbackContact, WinbackSalesTarget, WinbackStageHistory, WinbackMeetingAck, WinbackAppRecord, ...JOSH_COPY_TABLES]),
  ],
  controllers: [WinbackController, WinbackAppController, WinbackRestaurantPlaceController, WinbackIntakeController, WinbackLoginController, WinbackReportsController, GoalPlanningController, SalesWorkController, MarketingReadinessController],
  providers: [
    GoalInputsService, GoalDraftsService, CommercialSourcesService, CommercialDraftsService,
    AdminWriteGuard,
    WinbackStaffIdentityService,
    WinbackAppRoleGuard,
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
    JoshMatchLookup,
    JoshMatchService,
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
    OpportunityCollabService,
    SignalService,
    WinbackCatalogService,
    AppRecordsService,
    CommercialService,
  ],
  exports: [WinbackService, LeadService, ReportService, WinbackMirror, WinbackStaffActions, WinbackReports],
})
export class WinbackModule {}
