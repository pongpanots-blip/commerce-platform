import { assertPublicHttpUrl, BlockedUrlError, Resolver } from '../../../../shared-kernel/infrastructure/public-url';
import { SECRET_REF } from '../domain/template';
import type { WebhookHeader, WebhookMethod } from '../domain/workflow.types';

/** `code` is safe to store and show: it never carries header values or the target's body. */
export class WebhookSendError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly status: number | null = null) { super(code); }
}
export interface WebhookRequest { method: WebhookMethod; url: string; headers: WebhookHeader[]; body: string | null; deliveryId?: string }

/** One HTTP attempt of a marketing webhook (worker and the editor's test send). Throws WebhookSendError. */
export async function sendWebhook(
  req: WebhookRequest, secrets: Map<string, string>,
  opts: { fetchImpl?: typeof fetch; resolve?: Resolver; timeoutMs?: number } = {},
): Promise<{ status: number; body: string }> {
  try { await assertPublicHttpUrl(req.url, opts.resolve); } catch (e) {
    throw new WebhookSendError(e instanceof BlockedUrlError ? e.message : 'blocked_url', false);
  }
  const headers: Record<string, string> = {};
  for (const h of req.headers) {
    const ref = SECRET_REF.exec(h.value);
    if (!ref) { headers[h.key] = h.value; continue; }
    const value = secrets.get(ref[1]) ?? secrets.get(ref[1].toLowerCase());
    if (value === undefined) throw new WebhookSendError('secret_missing', false);
    headers[h.key] = value;
  }
  if (req.body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  if (req.deliveryId) headers['x-delivery-id'] = req.deliveryId;
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(req.url, {
      method: req.method, headers, body: req.method === 'GET' ? undefined : req.body ?? undefined,
      redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (e) {
    throw new WebhookSendError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network_error', true);
  }
  const body = (await res.text().catch(() => '')).slice(0, 2048);
  if (res.status >= 300 && res.status < 400) throw new WebhookSendError('redirect_not_followed', false, res.status);
  if (res.ok) return { status: res.status, body };
  throw new WebhookSendError(`http_${res.status}`, res.status >= 500 || res.status === 408 || res.status === 429, res.status);
}
