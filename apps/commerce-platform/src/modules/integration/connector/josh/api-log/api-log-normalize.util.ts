/** ใครเป็นคนยิง request นี้ — ใช้แยกแถวใน `/admin/api-logs` ว่าเป็น API ของเราเอง หรือเรียกออกไปหาระบบอื่น */
export type ApiLogSource = 'internal' | 'jagota' | 'kbank' | 'erp_webhook';

const SOURCE_BY_CONTEXT: Record<string, ApiLogSource> = {
  HttpLoggingInterceptor: 'internal',
  JagotaNodeApiService: 'jagota',
  JagotaOrderService: 'jagota',
  KbankApiClient: 'kbank',
  ErpInboundLog: 'erp_webhook',
};

/** เอาไว้ filter ตาม source — ผกผันของ SOURCE_BY_CONTEXT */
export const CONTEXTS_BY_SOURCE: Record<ApiLogSource, string[]> = Object.entries(
  SOURCE_BY_CONTEXT,
).reduce(
  (acc, [context, source]) => {
    acc[source].push(context);
    return acc;
  },
  { internal: [], jagota: [], kbank: [], erp_webhook: [] } as Record<
    ApiLogSource,
    string[]
  >,
);

/** Winston → Mongo เก็บ metadata ซ้อนกันได้ — ใช้ร่วมกับ MetricService */
export type NormalizedApiLog = {
  method: string;
  url: string;
  statusCode: number;
  isSuccess: boolean;
  durationMs: number;
  errorMessage?: string;
  response?: unknown;
  /** Request body — outbound call payload (Jagota/KBank) or rejected inbound webhook body. */
  payload?: unknown;
  query?: unknown;
  ip?: string;
  message: string;
  createdAt: Date;
  source: ApiLogSource;
  metadata?: Record<string, unknown>;
};

export function getLogMetadata(
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const meta = doc.metadata;
  if (!meta || typeof meta !== 'object') {
    return {};
  }

  const outer = meta as Record<string, unknown>;
  const inner = outer.metadata;
  if (inner && typeof inner === 'object') {
    return { ...outer, ...(inner as Record<string, unknown>) };
  }

  return outer;
}

export function getLogContext(doc: Record<string, unknown>): string {
  const direct = doc.context;
  if (typeof direct === 'string') {
    return direct;
  }

  const metaContext = getLogMetadata(doc).context;
  return typeof metaContext === 'string' ? metaContext : '';
}

export function normalizeApiLogDoc(
  doc: Record<string, unknown>,
): NormalizedApiLog {
  const meta = getLogMetadata(doc);
  const message = String(doc.message ?? '');

  let method = String(meta.method ?? '');
  let url = String(meta.url ?? '');

  if (!url && message) {
    const match = message.match(
      /\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\]\s+(\S+)/,
    );
    if (match) {
      method = method || match[1];
      url = url || match[2];
    }
  }

  const statusCode = Number(meta.statusCode ?? doc.statusCode ?? 0);
  const isSuccess = Boolean(
    meta.is_success ??
      (statusCode > 0 ? statusCode < 400 : /API Success/i.test(message)),
  );

  const createdAtRaw = doc.createdAt ?? doc.timestamp ?? doc.updatedAt;
  const createdAt = createdAtRaw
    ? new Date(createdAtRaw as string | Date)
    : new Date();

  return {
    method,
    url,
    statusCode,
    isSuccess,
    durationMs: Number(meta.duration_ms ?? meta.durationMs ?? 0),
    errorMessage:
      meta.errorMessage != null ? String(meta.errorMessage) : undefined,
    response: meta.response,
    payload: meta.payload,
    query: meta.query,
    ip: meta.ip != null ? String(meta.ip) : undefined,
    message,
    createdAt,
    source: SOURCE_BY_CONTEXT[getLogContext(doc)] ?? 'internal',
    metadata: meta,
  };
}

/**
 * Contexts shown on `/admin/api-logs` — the general HTTP interceptor plus the
 * outbound integration clients whose request/response payload has nowhere
 * else to surface (JagotaNodeApiService, KbankApiClient), the order-create
 * gate warnings (JagotaOrderService — quotation/order-period/kill-switch
 * blocks that stop a sync before it ever reaches JagotaNodeApiService, so
 * without this a blocked order-create shows no log at all), and rejected ERP
 * webhooks (ErpInboundLog, from ErpKeyGuard — accepted ones already have a
 * full record in erp_inbound_logs, this view just shows the same short line).
 */
export const VISIBLE_API_LOG_CONTEXTS = new Set([
  'HttpLoggingInterceptor',
  'JagotaNodeApiService',
  'JagotaOrderService',
  'KbankApiClient',
  'ErpInboundLog',
]);

export function isVisibleApiLogDoc(doc: Record<string, unknown>): boolean {
  const context = getLogContext(doc);
  if (!VISIBLE_API_LOG_CONTEXTS.has(context)) {
    return false;
  }

  // ERP inbound OK/FAIL lines under HttpLoggingInterceptor are a short-form
  // duplicate of erp_inbound_logs — keep them out of this general view.
  if (context !== 'HttpLoggingInterceptor') {
    return true;
  }

  const normalized = normalizeApiLogDoc(doc);
  if (normalized.url.startsWith('/api/erp')) {
    return false;
  }

  return !/ERP inbound/i.test(normalized.message);
}
