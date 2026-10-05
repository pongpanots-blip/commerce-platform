import { Body, CanActivate, Controller, ExecutionContext, HttpCode, HttpStatus, Injectable, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { ERP_RELAY_EVENTS as E, ErpRelayService } from '../ingest/erp-relay.service';

/** Same secret, header and env as josh's credit-ingest guards, so nginx can fail over between the two. */
function secretMatches(context: ExecutionContext, header: string, env: string): boolean {
  const expected = process.env[env]?.trim();
  if (!expected) throw new UnauthorizedException(`${env} not configured`); // josh fails closed too
  const raw = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>().headers?.[header];
  const a = Buffer.from((Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException(`${header} invalid or missing`);
  return true;
}

@Injectable()
export class CreditNoteSecretGuard implements CanActivate {
  canActivate(c: ExecutionContext) { return secretMatches(c, 'x-credit-note-secret', 'CREDIT_NOTE_INGEST_SECRET'); }
}

@Injectable()
export class CreditBackSecretGuard implements CanActivate {
  canActivate(c: ExecutionContext) { return secretMatches(c, 'x-credit-back-secret', 'CREDIT_BACK_INGEST_SECRET'); }
}

/**
 * josh's two accounting webhooks, same paths and headers as josh (`/api/credit-notes/claim-approved`,
 * `/api/credit-backs/invoice-received`), so nginx can send them here first with josh as backup.
 * Kept verbatim (never lost) and relayed to josh with retry + dead-letter like the ERP calls; josh
 * creates the credit note / credit back with its own service (idempotent on cnNumber / invoiceNumber).
 * Answers `{ received: true }` — the created document is in josh (and in commerce's delivery log).
 */
@Public()
@Controller()
export class AccountingRelayController {
  constructor(private readonly relay: ErpRelayService) {}

  @Post('credit-notes/claim-approved') @HttpCode(HttpStatus.OK) @UseGuards(CreditNoteSecretGuard)
  async creditNote(@Body() b: unknown) {
    await this.relay.relay(E.creditNote, 'POST /credit-notes/claim-approved', b);
    return { received: true };
  }

  @Post('credit-backs/invoice-received') @HttpCode(HttpStatus.OK) @UseGuards(CreditBackSecretGuard)
  async creditBack(@Body() b: unknown, @Query('lang') lang?: string) {
    // josh reads `?lang` or body.lang; the relay carries only the body.
    const body = lang && b && typeof b === 'object' && !Array.isArray(b) ? { ...(b as object), lang: (b as { lang?: unknown }).lang ?? lang } : b;
    await this.relay.relay(E.creditBack, 'POST /credit-backs/invoice-received', body);
    return { received: true };
  }
}
