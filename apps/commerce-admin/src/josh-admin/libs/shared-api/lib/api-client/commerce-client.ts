/**
 * axios-shaped client for josh shared-api modules whose feature moved to commerce (competitor prices, scraping,
 * marketing research). Unlike `apiClient` (josh's admin routes via the relay), this calls commerce's own /api —
 * same routes and `{ status, data, message }` envelope as josh — so josh's page and API code stay unchanged.
 * josh `/competitor-scraping/*` is `/scraping/*` in commerce.
 */
import type { AxiosResponse } from 'axios';
import { api, request, session } from '../../../../../lib/api';

type Config = { params?: Record<string, unknown>; responseType?: string; timeout?: number };
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const ROUTES: [RegExp, string][] = [[/^\/competitor-scraping(?=\/|$)/, '/scraping']];

export function commercePath(url: string, params?: Record<string, unknown>) {
  let [path, qs] = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '').split('?');
  for (const [from, to] of ROUTES) path = path.replace(from, to);
  const query = new URLSearchParams(qs ?? '');
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    query.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

async function call<T>(method: Method, url: string, body?: unknown, config?: Config): Promise<AxiosResponse<T>> {
  const path = commercePath(url, config?.params);
  try {
    let data: T;
    if (config?.responseType === 'blob') {
      const token = session.get();
      const res = await fetch(`${api.base}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { status: res.status });
      data = (await res.blob()) as T;
    } else {
      data = await request<T>(path, { method, ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }) });
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as AxiosResponse<T>;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number }).status ?? 400;
    throw Object.assign(new Error(message), { isAxiosError: true, response: { status, data: { message } } });
  }
}

type Ownership = { segments: boolean; salesReps: boolean; categories?: boolean };
let owned: Promise<Ownership> | null = null;
/** Which josh features commerce owns right now (GET /api/ownership), fetched once per page load; josh if unknown. */
export const ownership = () => (owned ??= request<Ownership>('/ownership').catch((): Ownership => ({ segments: false, salesReps: false })));

export const commerceClient = {
  get: <T = any, R = AxiosResponse<T>>(url: string, config?: Config): Promise<R> => call<T>('GET', url, undefined, config) as Promise<R>,
  delete: <T = any, R = AxiosResponse<T>>(url: string, config?: Config & { data?: unknown }): Promise<R> => call<T>('DELETE', url, config?.data, config) as Promise<R>,
  post: <T = any, R = AxiosResponse<T>>(url: string, body?: unknown, config?: Config): Promise<R> => call<T>('POST', url, body ?? {}, config) as Promise<R>,
  patch: <T = any, R = AxiosResponse<T>>(url: string, body?: unknown, config?: Config): Promise<R> => call<T>('PATCH', url, body ?? {}, config) as Promise<R>,
  put: <T = any, R = AxiosResponse<T>>(url: string, body?: unknown, config?: Config): Promise<R> => call<T>('PUT', url, body ?? {}, config) as Promise<R>,
};
