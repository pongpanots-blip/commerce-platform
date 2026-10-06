import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

type IntakeRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * Shared-secret guard for the external lead intake endpoint.
 *
 * ระบบภายนอกยิงเข้ามาพร้อม header `X-Winback-Key` เทียบกับ env `WINBACK_INTAKE_KEY`.
 * - ตั้ง key แล้ว mismatch → 401
 * - ยังไม่ตั้ง key + NODE_ENV=production → fail closed (401)
 * - ยังไม่ตั้ง key + NODE_ENV อื่น (local/dev) → ปล่อยผ่าน + log เตือน
 *
 * ไม่ log ค่า key ที่ส่งเข้ามา.
 */
@Injectable()
export class WinbackIntakeKeyGuard implements CanActivate {
  private readonly logger = new Logger(WinbackIntakeKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.WINBACK_INTAKE_KEY?.trim();
    const request = context.switchToHttp().getRequest<IntakeRequest>();

    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn(
          `Winback intake 401: [${request.method ?? '?'}] ${request.url ?? '?'} reason=WINBACK_INTAKE_KEY not configured`,
        );
        throw new UnauthorizedException('Winback intake not configured');
      }

      this.logger.warn(
        'WINBACK_INTAKE_KEY ยังไม่ถูกตั้งค่า — ปล่อย request ผ่านชั่วคราว (dev only)',
      );
      return true;
    }

    const header = request.headers?.['x-winback-key'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || provided.trim() !== expected) {
      this.logger.warn(
        `Winback intake 401: [${request.method ?? '?'}] ${request.url ?? '?'} reason=X-Winback-Key invalid or missing`,
      );
      throw new UnauthorizedException('X-Winback-Key ไม่ถูกต้อง');
    }

    return true;
  }
}
