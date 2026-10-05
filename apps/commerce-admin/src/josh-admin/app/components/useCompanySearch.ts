import { getCompany } from '@josh/shared-api';
import { useEffect, useState } from 'react';

export type CompanyHit = { id: string; name: string; registerNumber: string | null };

type Result = { term: string; hits: CompanyHit[]; failed: boolean };

/**
 * Debounced admin company search (`GET /company?search=`) for the company pickers (mechanic
 * audience, Push campaign audience). Returns nothing for an empty box, and nothing for a term whose
 * results have not landed yet — never the results of an older term. A failed search reports
 * `failed` with no hits instead of an empty-looking result.
 */
export function useCompanySearch(query: string, limit = 8): { hits: CompanyHit[]; failed: boolean } {
  const term = query.trim();
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!term) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      // the shared `getCompany` puts `filter` straight into the URL
      getCompany(1, limit, encodeURIComponent(term))
        .then((res) => {
          if (cancelled) return;
          const rows = (res?.data?.data ?? res?.data ?? []) as Array<{
            id: string;
            name?: string;
            company_name?: string;
            register_number?: string | null;
          }>;
          setResult({
            term,
            failed: false,
            hits: (Array.isArray(rows) ? rows : []).map((row) => ({
              id: row.id,
              name: row.name || row.company_name || row.id,
              registerNumber: row.register_number ?? null,
            })),
          });
        })
        .catch(() => {
          if (!cancelled) setResult({ term, hits: [], failed: true });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [term, limit]);

  return result && result.term === term ? result : { hits: [], failed: false };
}
