/**
 * commerce-admin replacement for josh shared-api's axios client. Every call josh's own API functions
 * make goes to josh's admin route through commerce (POST /api/josh/admin-call) — josh runs it as the
 * signed-in staff member with josh's own guards and DTOs. Answers come back shaped like axios
 * (`{ data, status }`); a josh error rejects with `{ response: { status, data: { message } } }` like
 * axios, so josh's error handling keeps working. FormData bodies (uploads, any size josh's route
 * takes) go as real multipart (POST /api/josh/admin-call/upload); a binary answer (export) comes back
 * as a Blob, which is what josh's `responseType: 'blob'` callers expect.
 */
import type { AxiosResponse } from 'axios';
import { api, isJoshFile, joshAdmin, joshFileBlob } from '../../../../../lib/api';

type Config = { params?: Record<string, unknown>; headers?: Record<string, string>; responseType?: string; signal?: AbortSignal; timeout?: number };
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function call<T>(method: Method, url: string, body?: unknown, config?: Config): Promise<AxiosResponse<T>> {
  const [path, qs] = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '').split('?');
  const query: Record<string, string> = Object.fromEntries(new URLSearchParams(qs ?? ''));
  for (const [k, v] of Object.entries(config?.params ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    query[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  const q = Object.keys(query).length ? query as Record<string, string> : undefined;
  let fields: Record<string, unknown> | undefined;
  const files: { field: string; file: File }[] = [];
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    fields = {};
    for (const [k, v] of (body as unknown as { entries(): Iterable<[string, FormDataEntryValue]> }).entries()) {
      if (typeof v === 'string') fields[k] = v;
      else files.push({ field: k, file: v as File });
    }
  }
  try {
    const answer = files.length && method !== 'GET' && method !== 'DELETE'
      ? await joshAdmin.upload<T>(method, path, fields!, files, q)
      : await joshAdmin.call<T>(method, path, fields ?? body, { query: q });
    const data = (isJoshFile(answer) ? joshFileBlob(answer) : answer) as T;
    return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as AxiosResponse<T>;
  } catch (e) {
    const message = e instanceof Error ? e.message.replace(/^josh: /, '') : String(e);
    throw Object.assign(new Error(message), { isAxiosError: true, response: { status: /admin only|not open|Forbidden/i.test(message) ? 403 : 400, data: { message } } });
  }
}

export const apiClient = {
  get: <T = any, R = AxiosResponse<T>>(url: string, config?: Config): Promise<R> => call<T>('GET', url, undefined, config) as Promise<R>,
  delete: <T = any, R = AxiosResponse<T>>(url: string, config?: Config & { data?: unknown }): Promise<R> => call<T>('DELETE', url, config?.data, config) as Promise<R>,
  post: <T = any, R = AxiosResponse<T>>(url: string, body?: unknown, config?: Config): Promise<R> => call<T>('POST', url, body ?? {}, config) as Promise<R>,
  patch: <T = any, R = AxiosResponse<T>>(url: string, body?: unknown, config?: Config): Promise<R> => call<T>('PATCH', url, body ?? {}, config) as Promise<R>,
  put: <T = any, R = AxiosResponse<T>>(url: string, body?: unknown, config?: Config): Promise<R> => call<T>('PUT', url, body ?? {}, config) as Promise<R>,
  interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
  defaults: { headers: { common: {} as Record<string, string> }, baseURL: '' },
};

/**
 * A write through one of commerce's josh actions (POST /api/josh/…) — the way in once josh's
 * COMMERCE_OWNS_* lock refuses the relayed admin route. Errors reject like axios, as `call` does.
 */
export async function viaCommerceAction<T>(path: string, body: unknown): Promise<T> {
  try {
    return await api.post<T>(path, body);
  } catch (e) {
    const message = e instanceof Error ? e.message.replace(/^josh: /, '') : String(e);
    const status = (e as { status?: number }).status ?? 400;
    throw Object.assign(new Error(message), { isAxiosError: true, response: { status, data: { ...((e as { details?: object }).details ?? {}), message } } });
  }
}

/** josh's absolute API URL — only for links josh builds itself (e.g. an export opened in a new tab). */
export function resolveApiBaseUrl(): string { return '/api'; }
export type ApiClientCredentials = { clientId: string; clientSecret: string };
export type ApiClientTokenMode = 'shop' | 'admin';
export function configureApiClientAuth(_c: ApiClientCredentials): void { /* commerce signs the calls */ }
export function configureApiClientTokenMode(_m: ApiClientTokenMode): void { /* commerce signs the calls */ }
export function configureApiClientLocale(..._a: unknown[]): void { /* josh admin answers in its default language */ }
export function resolveApiClientCredentials(): ApiClientCredentials | null { return null; }
