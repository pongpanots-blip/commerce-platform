import { Module } from '@nestjs/common';
import { AuditLogsController } from './presentation/audit-logs.controller';

/** Read side of audit_logs. Writers insert the AuditLog entity directly where the change happens. */
@Module({ controllers: [AuditLogsController] })
export class AuditModule {}
