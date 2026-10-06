import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { toCamelCaseDeep } from './winback-camel.util';

function isPoolEnvelope(value: unknown): value is { data: unknown; meta?: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  if (!keys.includes('data')) return false;
  return keys.every((k) => k === 'data' || k === 'meta');
}

export function wrapWinbackResponse(payload: unknown): {
  data: unknown;
  meta?: unknown;
} {
  if (payload === undefined) return { data: null };
  if (isPoolEnvelope(payload)) {
    const out: { data: unknown; meta?: unknown } = {
      data: toCamelCaseDeep(payload.data),
    };
    if ('meta' in payload) out.meta = toCamelCaseDeep(payload.meta);
    return out;
  }
  return { data: toCamelCaseDeep(payload) };
}

@Injectable()
export class WinbackResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((payload) => wrapWinbackResponse(payload)));
  }
}
