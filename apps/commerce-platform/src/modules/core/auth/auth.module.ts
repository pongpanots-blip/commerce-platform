import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/infrastructure/user.entity';
import { PortalAuthService } from './application/portal-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.register({
      secret: process.env.PORTAL_JWT_SECRET || 'dev-portal-secret',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  providers: [PortalAuthService],
  exports: [PortalAuthService, JwtModule],
})
export class AuthModule {}
