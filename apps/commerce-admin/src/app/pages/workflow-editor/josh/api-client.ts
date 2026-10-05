import { joshAdmin } from '../../../../lib/api';

/**
 * Stand-in for josh's shared-api `apiClient` (axios) so josh's own API functions run unchanged:
 * every call goes to josh's admin route through commerce (POST /api/josh/admin-call), and the answer
 * comes back as axios would give it — `{ data: <josh's response body> }`.
 */
type Opts = { params?: Record<string, unknown>; headers?: Record<string, string> };
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function call<T>(method: Method, url: string, body?: unknown, opts?: Opts): Promise<{ data: T }> {
  const [path, qs] = url.split('?');
  const query: Record<string, string> = Object.fromEntries(new URLSearchParams(qs ?? ''));
  for (const [k, v] of Object.entries(opts?.params ?? {})) if (v !== undefined && v !== null) query[k] = String(v);
  return joshAdmin.call<T>(method, path, body, { query: Object.keys(query).length ? query : undefined }).then((data) => ({ data }));
}

export const apiClient = {
  get: <T = any>(url: string, opts?: Opts) => call<T>('GET', url, undefined, opts),
  delete: <T = any>(url: string, opts?: Opts) => call<T>('DELETE', url, undefined, opts),
  post: <T = any>(url: string, body?: unknown, opts?: Opts) => call<T>('POST', url, body ?? {}, opts),
  patch: <T = any>(url: string, body?: unknown, opts?: Opts) => call<T>('PATCH', url, body ?? {}, opts),
  put: <T = any>(url: string, body?: unknown, opts?: Opts) => call<T>('PUT', url, body ?? {}, opts),
};
