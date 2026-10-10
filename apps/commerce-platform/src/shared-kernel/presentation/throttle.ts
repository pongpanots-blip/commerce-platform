import { applyDecorators, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';

/**
 * `@Throttle({ default: { limit, ttl } })` as josh writes it (@nestjs/throttler), on commerce's
 * express-rate-limit: per client IP, per decorated route.
 */
export function Throttle(options: { default: { limit: number; ttl: number } }) {
  const limiter = rateLimit({
    windowMs: options.default.ttl, limit: options.default.limit, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS)),
  });

  @Injectable()
  class RouteThrottleGuard implements CanActivate {
    canActivate(context: ExecutionContext): Promise<boolean> {
      const http = context.switchToHttp();
      return new Promise((resolve, reject) =>
        limiter(http.getRequest<Request>(), http.getResponse<Response>(), (error?: unknown) => (error ? reject(error) : resolve(true))));
    }
  }
  return applyDecorators(UseGuards(RouteThrottleGuard));
}
