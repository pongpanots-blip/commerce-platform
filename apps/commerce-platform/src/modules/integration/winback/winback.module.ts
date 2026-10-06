import { Module, OnModuleInit, Logger, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { JoshModule } from '../../integration/connector/josh/josh.module';
import { JoshReplica } from '../../integration/connector/josh/josh-replica';
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
import { JOSH_REPLICA_TABLES } from './josh-replica-tables';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackContact } from './entities/winback-contact.entity';
import { WinbackSalesTarget } from './entities/winback-sales-target.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import { WinbackMeetingAck } from './entities/winback-meeting-ack.entity';
import { JoshUser as User } from './josh-replica-tables';
import { JoshOrder as Order } from './josh-replica-tables';
import { JoshErpSalesHistory as ErpSalesHistory } from './josh-replica-tables';
import { JoshCompany as Company } from './josh-replica-tables';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-replica-tables';
import { WinbackController } from './winback.controller';
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

/**
 * josh's repository for a josh table, on josh's READ REPLICA — resolved per call, so the copied josh
 * services take it like any repository. The replica connects at start-up (and again after a failed
 * query drops the pool); until then a call answers 503.
 */
const REPOSITORY_FIELDS = new Set(['manager', 'metadata', 'target', 'queryRunner']);

function replicaRepository<T extends ObjectLiteral>(replica: JoshReplica, entity: EntityTarget<T>): Repository<T> {
  const repo = () => {
    const ds = replica.current();
    if (!ds) {
      void replica.dataSource().catch(() => undefined);
      throw new ServiceUnavailableException('josh replica is not connected yet (JOSH_DATABASE_URL)');
    }
    return ds.getRepository(entity) as unknown as Record<PropertyKey, unknown>;
  };
  return new Proxy({} as Repository<T>, {
    get(_target, prop) {
      // Nest and its explorers probe every provider while wiring: answer without touching the replica.
      if (typeof prop === 'symbol') return undefined;
      if (prop in Repository.prototype) {
        return (...args: unknown[]) => { const r = repo(); return (r[prop] as (...a: unknown[]) => unknown).apply(r, args); };
      }
      return REPOSITORY_FIELDS.has(prop) ? replica.current()?.getRepository(entity)[prop as 'manager'] : undefined;
    },
  });
}

// The app signs in at josh and sends josh's access token: commerce's staff guard steps aside and
// AdminWriteGuard (josh's checks, on the replica) decides. Writes only when commerce owns winback.
for (const c of [WinbackController, WinbackIntakeController]) { Public()(c); UseGuards(WinbackOwnershipGuard)(c); }

/**
 * Winback — the sales win-back CRM behind the saleactivity app — run by commerce: josh's module
 * (apps/backend/src/app/winback, copied as is) on commerce's own winback tables. josh's data it
 * reads (users, orders, companies, restaurant places, ERP sales history, cuisine) comes from josh's
 * replica; notifications and the welcome-lead email are delivered by josh through the outbox.
 */
@Module({
  imports: [
    JoshModule,
    ApiKeyModule,
    TypeOrmModule.forFeature([WinbackAccount, WinbackActivity, WinbackContact, WinbackSalesTarget, WinbackStageHistory, WinbackMeetingAck]),
  ],
  controllers: [WinbackController, WinbackIntakeController, WinbackLoginController],
  providers: [
    ...JOSH_REPLICA_TABLES.map((entity) => ({ provide: getRepositoryToken(entity), useFactory: (replica: JoshReplica) => replicaRepository(replica, entity), inject: [JoshReplica] })),
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
  ],
  exports: [WinbackService, LeadService, ReportService, WinbackMirror, WinbackStaffActions],
})
export class WinbackModule implements OnModuleInit {
  private readonly logger = new Logger(WinbackModule.name);
  constructor(private readonly replica: JoshReplica) {}

  async onModuleInit() {
    if (!this.replica.configured) return;
    await this.replica.dataSource().catch((error) => this.logger.warn(`josh replica not reachable at start-up: ${error instanceof Error ? error.message : error}`));
  }
}
