import { SalesRepIdentity } from './application/sales-rep-identity.service';
import { Module } from '@nestjs/common';
import { COMMERCE_JWT_ISSUER } from '../../../shared-kernel/presentation/jwt-issuer';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/infrastructure/user.entity';
import { AuditLog } from '../audit/infrastructure/audit-log.entity';
import { APP_GUARD } from '@nestjs/core';
import { PortalAuthService } from './application/portal-auth.service';
import { StaffAccountsService } from './application/staff-accounts.service';
import { StaffAccountsController } from './presentation/staff-accounts.controller';
import { StaffAuthGuard } from './presentation/staff-auth.guard';
import { StaffAuthController } from './presentation/staff-auth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuditLog]),
    JwtModule.register({
      secret: process.env.PORTAL_JWT_SECRET || 'dev-portal-secret',
      // issuer: tells commerce tokens apart from josh's without trying secrets (winback AdminWriteGuard).
      signOptions: { expiresIn: '12h', issuer: COMMERCE_JWT_ISSUER },
    }),
  ],
  controllers: [StaffAuthController, StaffAccountsController],
  // Global default-deny: every HTTP route needs a staff token unless @Public().
  providers: [SalesRepIdentity, PortalAuthService, StaffAccountsService, { provide: APP_GUARD, useClass: StaffAuthGuard }],
  exports: [SalesRepIdentity, PortalAuthService, JwtModule],
})
export class AuthModule {}
