import { apiClient } from '@josh/shared-api';
import { useEffect, useState } from 'react';
import { KycDocument, KycDocumentStatus, KycDocumentType, KycQueueEntry } from './kyc.types';

/**
 * Backend document status enum (`kyc-document-status.dto.ts`) uses
 * `not_submitted` to match the customer-facing endpoint; the already-built
 * web-admin UI/components use `none`. Mapped here at the API-call boundary
 * so `kyc.types.ts` and the UI components stay unchanged.
 */
function mapDocumentStatus(status: string): KycDocumentStatus {
  return status === 'not_submitted' ? 'none' : (status as KycDocumentStatus);
}

function mapDocument(raw: any): KycDocument {
  return {
    status: mapDocumentStatus(raw?.status),
    submittedAt: raw?.submittedAt ?? undefined,
    decidedAt: raw?.decidedAt ?? undefined,
    rejectionReason: raw?.rejectionReason ?? undefined,
    thumbnailUrl: raw?.thumbnailUrl ?? undefined,
  };
}

/** Fetches the KYC queue from `GET /admin/kyc/documents`. */
async function fetchKycQueue(): Promise<KycQueueEntry[]> {
  const response = await apiClient.get('/admin/kyc/documents');
  const rows: any[] = response?.data?.data ?? [];

  return rows.map((row) => {
    const rawDocuments = row?.documents ?? {};
    const documents = {} as Record<KycDocumentType, KycDocument>;
    (['id_card', 'selfie', 'storefront'] as KycDocumentType[]).forEach((key) => {
      documents[key] = mapDocument(rawDocuments[key] ?? {});
    });

    return {
      id: row.id,
      companyName: row.companyName,
      customerType: row.customerType,
      documents,
    };
  });
}

export function useKycQueue() {
  const [entries, setEntries] = useState<KycQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);

    fetchKycQueue()
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((error: any) => {
        if (!cancelled) setLoadError(error?.message || 'โหลดคิว KYC ไม่สำเร็จ');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, loading, loadError };
}
