import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const logger = new Logger('JoshEventsSignature');

/** josh signs the exact body text (HMAC-SHA256 hex; JOSH_EVENTS_SECRET here = COMMERCE_EVENTS_SECRET on josh). */
export function verifyJoshSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env.JOSH_EVENTS_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new UnauthorizedException('josh events not configured');
    logger.warn('JOSH_EVENTS_SECRET not set — accepting unsigned josh events (non-production only)');
    return;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const presented = Buffer.from(signature ?? '', 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new UnauthorizedException('invalid x-signature');
  }
}
