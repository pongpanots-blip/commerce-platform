import { All, Body, CanActivate, Controller, ExecutionContext, HttpCode, HttpStatus, Injectable, Logger, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { StorefrontApiKeyGuard } from '../../../../../storefront/storefront-api-key.guard';
import { TrustedStorefrontKey } from '../../../../../storefront/trusted-storefront-key';
import { ERP_RELAY_EVENTS as E, ErpRelayService } from '../ingest/erp-relay.service';
import { LivechatLog } from './livechat-log.entity';

function headerSecret(context: ExecutionContext, header: string, env: string): boolean {
  const expected = process.env[env]?.trim();
  if (!expected) throw new UnauthorizedException(`${env} not configured`);
  const raw = context.switchToHttp().getRequest<Request>().headers[header];
  const a = Buffer.from((Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException(`${header} invalid or missing`);
  return true;
}

@Injectable()
export class KycSecretGuard implements CanActivate {
  canActivate(c: ExecutionContext) { return headerSecret(c, 'x-kyc-secret', 'KYC_WEBHOOK_SECRET'); }
}

@Injectable()
export class LivechatSecretGuard implements CanActivate {
  canActivate(c: ExecutionContext) { return headerSecret(c, 'x-livechat-secret', 'LIVECHAT_OUTBOUND_SECRET'); }
}

const textOf = (body: unknown): string | null => {
  const b = body as { text?: unknown; messages?: { text?: unknown }[] } | null;
  const t = b?.text ?? b?.messages?.map((m) => m.text).filter(Boolean).join(' | ');
  return typeof t === 'string' && t ? t.slice(0, 500) : null;
};

/**
 * CS-CRM ↔ josh shop traffic through commerce (the hub), both ways:
 * - CS-CRM → josh: KYC decisions and agent chat replies, same paths / headers / secrets as josh
 *   (`/api/webhooks/kyc-decision`, `/api/livechat/outbound`) so nginx can send them here first with
 *   josh as backup; kept and relayed to josh with retry like the ERP calls.
 * - josh → CS-CRM: the shop chat (josh LIVECHAT_VIA_COMMERCE) proxied to CS-CRM's livechat API; the
 *   answer is CS-CRM's, marked `x-livechat-relay`. Anything not from CS-CRM goes without the mark and
 *   josh then calls CS-CRM directly.
 * Every chat message either way is logged in `livechat_logs`.
 */
@Public()
@Controller()
export class CsCrmRelayController {
  private readonly logger = new Logger(CsCrmRelayController.name);

  constructor(private readonly relay: ErpRelayService, @InjectRepository(LivechatLog) private readonly logs: Repository<LivechatLog>) {}

  @Post('webhooks/kyc-decision') @HttpCode(HttpStatus.OK) @UseGuards(KycSecretGuard)
  async kyc(@Body() b: unknown) {
    await this.relay.relay(E.kycDecision, 'POST /webhooks/kyc-decision', b);
    return { received: true };
  }

  @Post('livechat/outbound') @HttpCode(HttpStatus.OK) @UseGuards(LivechatSecretGuard)
  async outbound(@Body() b: { visitorId?: string; externalMessageId?: string } | null) {
    await this.relay.relay(E.livechatOutbound, 'POST /livechat/outbound', b);
    await this.log('to_shop', 'POST /livechat/outbound', b, 200);
    return { ok: true };
  }

  @All('v1/storefront/livechat/*')
  @UseGuards(StorefrontApiKeyGuard)
  @TrustedStorefrontKey()
  async toCsCrm(@Req() req: Request, @Res() res: Response) {
    const base = process.env.LIVECHAT_CS_CRM_BASE_URL?.trim().replace(/\/$/, '');
    const key = process.env.LIVECHAT_API_KEY?.trim();
    if (!base || !key) return res.status(503).json({ message: 'CS-CRM live chat not configured here' }); // no mark → josh goes direct
    const sub = req.path.replace(/^.*\/v1\/storefront\/livechat/, '');
    if (!/^\/integrations\/livechat\/[a-z-]+$/.test(sub)) return res.status(404).json({ message: 'not a CS-CRM live chat route' });
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    try {
      const r = await fetch(`${base}${sub}${qs}`, {
        method: req.method, headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: req.method === 'GET' ? undefined : JSON.stringify(req.body ?? {}), signal: AbortSignal.timeout(7_000),
      });
      const text = await r.text();
      if (req.method !== 'GET') await this.log('to_cs_crm', `${req.method} ${sub}`, req.body, r.status);
      res.setHeader('x-livechat-relay', '1');
      return res.status(r.status).type('application/json').send(text);
    } catch (error) {
      this.logger.warn(`CS-CRM ${sub} failed: ${error instanceof Error ? error.message : error}`);
      return res.status(502).json({ message: 'CS-CRM did not answer' });
    }
  }

  private async log(direction: 'to_cs_crm' | 'to_shop', route: string, body: unknown, status: number) {
    const b = body as { visitorId?: string; messages?: { visitorId?: string }[] } | null;
    await this.logs.insert({ direction, route, visitorId: (b?.visitorId ?? b?.messages?.[0]?.visitorId ?? null)?.slice(0, 100) ?? null,
      text: textOf(body), status, payload: body as object }).catch((e) => this.logger.warn(`livechat log failed: ${e instanceof Error ? e.message : e}`));
  }
}
