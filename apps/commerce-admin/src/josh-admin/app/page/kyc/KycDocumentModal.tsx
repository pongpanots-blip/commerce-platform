// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import { useState } from 'react';
import { KYC_DOCUMENT_TYPES, KycQueueEntry } from './kyc.types';
import { KycStatusBadge } from './KycStatusBadge';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  entry: KycQueueEntry;
  onClose: () => void;
};

function formatTimestamp(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), { dateStyle: 'medium', timeStyle: 'short' });
}

type ThumbnailProps = {
  thumbnailUrl?: string | null;
  label: string;
  placeholderLabel: string;
  isNone: boolean;
};

/**
 * Renders the signed document image when available; falls back to the
 * text-label placeholder box for missing documents (`isNone`), a stale/
 * expired signed URL, or any other image load failure.
 */
function DocumentThumbnail({ thumbnailUrl, label, placeholderLabel, isNone }: ThumbnailProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (thumbnailUrl && !imageFailed) {
    return (
      <img
        src={thumbnailUrl}
        alt={label}
        className="h-[72px] w-[72px] flex-none rounded-lg border border-gray-200 object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      className={`flex h-[72px] w-[72px] flex-none items-center justify-center rounded-lg border border-gray-200 text-center text-[11px] font-semibold ${
        isNone ? 'bg-gray-50 text-gray-400' : 'bg-gradient-to-br from-gray-200 to-gray-300 text-gray-600'
      }`}
    >
      {placeholderLabel}
    </div>
  );
}

/** View-only document detail modal — no approve/reject actions. */
export default function KycDocumentModal({ entry, onClose }: Props) {
  __useUiLocale();
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-base font-bold text-gray-800">{__uiText("เอกสารยืนยันตัวตน")}</h2>
          <button
            type="button"
            aria-label={__uiText("ปิด")}
            className="text-gray-400 hover:text-gray-600"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-gray-400">
          {entry.companyName} · {entry.customerType}
        </p>

        <div className="flex flex-col gap-3">
          {KYC_DOCUMENT_TYPES.map((docType) => {
            const doc = entry.documents[docType.key];
            const submittedText = formatTimestamp(doc.submittedAt);
            const decidedText = formatTimestamp(doc.decidedAt);

            return (
              <div key={docType.key} className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-gray-700">{docType.label}</span>
                  <KycStatusBadge status={doc.status} />
                </div>
                <div className="flex items-start gap-3">
                  <DocumentThumbnail
                    thumbnailUrl={doc.thumbnailUrl}
                    label={docType.label}
                    placeholderLabel={doc.status === 'none' ? 'ไม่มีไฟล์' : docType.thumbnailLabel}
                    isNone={doc.status === 'none'}
                  />
                  <div className="min-w-0 flex-1 text-xs leading-relaxed text-gray-500">
                    {doc.status === 'none' ? (
                      <span>{__uiText("ยังไม่มีการส่งเอกสารนี้")}</span>
                    ) : (
                      <>
                        {doc.status === 'rejected' && decidedText && <span>{__uiText("ปฏิเสธเมื่อ ")}{decidedText}</span>}
                        {doc.status === 'approved' && decidedText && <span>{__uiText("ยืนยันเมื่อ ")}{decidedText}</span>}
                        {doc.status === 'pending' && submittedText && <span>{__uiText("ส่งเมื่อ ")}{submittedText}</span>}
                      </>
                    )}
                    {doc.status === 'rejected' && doc.rejectionReason && (
                      <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800">
                        <strong>{__uiText("เหตุผลที่ปฏิเสธ:")}</strong> {doc.rejectionReason}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
          {__uiText("การอนุมัติ/ปฏิเสธคำขอนี้ทำในระบบ CS-CRM แยกต่างหาก หน้านี้ใช้สำหรับดูเอกสารเท่านั้น")}</p>
      </div>
    </div>
  );
}
