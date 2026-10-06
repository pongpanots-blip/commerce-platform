type ErrorLike = {
  message?: unknown;
  duplicate_skus?: unknown;
  response?: {
    data?: {
      message?: unknown;
      duplicate_skus?: unknown;
      data?: { duplicate_skus?: unknown };
    };
  };
};

const asText = (v: unknown): string | null => {
  if (typeof v === 'string' && v) return v;
  if (Array.isArray(v) && v.length) return v.join(', ');
  return null;
};

/**
 * shared-api `unwrap` throws a plain `Error(envelope.message)` (backend answers 200 + message);
 * axios HTTP errors carry `response.data.message` (string or string[]).
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as ErrorLike;
  return asText(e.response?.data?.message) ?? asText(e.message) ?? fallback;
}

/** `duplicate_skus` from the error object itself or the axios response body; [] if absent. */
export function getDuplicateSkus(error: unknown): string[] {
  const e = (error ?? {}) as ErrorLike;
  const d = e.response?.data;
  const found = [
    e.duplicate_skus,
    d?.duplicate_skus,
    d?.data?.duplicate_skus,
  ].find(Array.isArray);
  return (found as unknown[] | undefined)?.map(String) ?? [];
}
