import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { ResearchActor } from '../research.types';
import type { StaffRequest } from '../../../../shared-kernel/presentation/auth.decorators';

@Injectable()
export class ResearchAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<StaffRequest>();
    const staff = request.staff;
    if (!staff || !isUUID(staff.userId))
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบด้วยบัญชีบริษัท');
    if (!['marketing', 'admin'].includes(staff.role))
      throw new ForbiddenException('เฉพาะทีม Marketing และ admin เท่านั้น');
    return true;
  }
}

@Injectable()
export class ResearchWorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const expected = process.env.RESEARCH_WORKER_TOKEN?.trim();
    const header = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>()
      .headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (
      process.env.RESEARCH_WORKER_ENABLED !== 'true' ||
      !expected ||
      expected.length < 32 ||
      !presented ||
      presented.length > 512
    )
      throw new UnauthorizedException(
        'Research worker ยังไม่เปิดใช้งานหรือ credential ไม่ถูกต้อง',
      );
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(hash(expected), hash(presented)))
      throw new UnauthorizedException('Research worker credential ไม่ถูกต้อง');
    return true;
  }
}
