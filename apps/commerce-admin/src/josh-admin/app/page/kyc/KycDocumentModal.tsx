// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
import { useState } from 'react';
import { KYC_DOCUMENT_TYPES, KycQueueEntry } from './kyc.types';
import { KycStatusBadge, customerTypeLabel } from './KycStatusBadge';

// ui-copy-migration: only literal UI copy and notification templates
import { Modal, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
        className="h-[72px] w-[72px] flex-none rounded-lg border border-secondary-container object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      className={`flex h-[72px] w-[72px] flex-none items-center justify-center rounded-lg border border-secondary-container text-center text-[11px] font-semibold ${
        isNone ? 'bg-surface-container-low text-outline' : 'bg-surface-container text-on-surface-variant'
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
    <Modal title={__uiText("เอกสารยืนยันตัวตน")} onClose={onClose} width={520}>
        <p className="text-xs text-on-surface-variant">
          {entry.companyName} · {customerTypeLabel(entry.customerType)}
        </p>

        <div className="flex flex-col gap-3">
          {KYC_DOCUMENT_TYPES.map((docType) => {
            const doc = entry.documents[docType.key];
            const submittedText = formatTimestamp(doc.submittedAt);
            const decidedText = formatTimestamp(doc.decidedAt);

            return (
              <div key={docType.key} className="rounded-lg border border-secondary-container p-3">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-on-surface">{docType.label}</span>
                  <KycStatusBadge status={doc.status} />
                </div>
                <div className="flex items-start gap-3">
                  <DocumentThumbnail
                    thumbnailUrl={doc.thumbnailUrl}
                    label={docType.label}
                    placeholderLabel={doc.status === 'none' ? __uiText('ไม่มีไฟล์') : docType.thumbnailLabel}
                    isNone={doc.status === 'none'}
                  />
                  <div className="min-w-0 flex-1 text-xs leading-relaxed text-on-surface-variant">
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
                      <div className="mt-2 rounded-md bg-danger-container px-2.5 py-2 text-xs text-danger">
                        <strong>{__uiText("เหตุผลที่ปฏิเสธ:")}</strong> {doc.rejectionReason}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="border-t border-secondary-container pt-3 text-[11px] text-on-surface-variant">
          {__uiText("หน้านี้ใช้ดูเอกสารอย่างเดียว การอนุมัติหรือปฏิเสธทำในระบบบริการลูกค้า (CS-CRM)")}</p>
    </Modal>
  );
}
