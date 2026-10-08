import { SalesRepIdentity } from './application/sales-rep-identity.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/infrastructure/user.entity';
import { AuditLog } from '../audit/infrastructure/audit-log.entity';
import { AuthRefreshToken } from './infrastructure/auth-refresh-token.entity';
import { APP_GUARD } from '@nestjs/core';
import { PortalAuthService } from './application/portal-auth.service';
import { StaffAccountsService } from './application/staff-accounts.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { StaffAccountsController } from './presentation/staff-accounts.controller';
import { StaffAuthGuard } from './presentation/staff-auth.guard';
import { StaffAuthController } from './presentation/staff-auth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuditLog, AuthRefreshToken]),
    JwtModule.register({
      secret: process.env.PORTAL_JWT_SECRET || 'dev-portal-secret',
      // Default for other signers. Staff/portal sign-in access tokens pass their own short TTL
      // (AUTH_ACCESS_TOKEN_TTL_SECONDS, see RefreshTokenService).
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [StaffAuthController, StaffAccountsController],
  // Global default-deny: every HTTP route needs a staff token unless @Public().
  providers: [SalesRepIdentity, PortalAuthService, RefreshTokenService, StaffAccountsService, { provide: APP_GUARD, useClass: StaffAuthGuard }],
  exports: [SalesRepIdentity, PortalAuthService, RefreshTokenService, JwtModule],
})
export class AuthModule {}
