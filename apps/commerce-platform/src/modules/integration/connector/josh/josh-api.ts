import { createHmac } from 'node:crypto';

/** JOSH_API_URL + JOSH_EVENTS_SECRET set: the offload jobs can write results back to josh. */
export function joshApiConfigured(): boolean {
  return !!process.env.JOSH_API_URL?.trim() && !!process.env.JOSH_EVENTS_SECRET?.trim();
}

/** POST a result to josh's internal API, HMAC-signed like the event webhooks (`x-signature`). Throws on non-2xx. */
export async function postToJosh<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const text = JSON.stringify(body);
  const res = await fetch(`${process.env.JOSH_API_URL!.trim().replace(/\/$/, '')}${path}`, {
    method: 'POST', body: text, signal: AbortSignal.timeout(timeoutMs),
    headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', process.env.JOSH_EVENTS_SECRET!.trim()).update(text).digest('hex') },
  });
  if (!res.ok) throw new Error(`josh answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}
