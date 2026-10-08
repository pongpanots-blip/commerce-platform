// ui-metadata-migration: static labels and UI notices only
import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import { KycDocumentStatus } from './kyc.types';

const STATUS_LABEL: Record<KycDocumentStatus, string> = {
  get none(){return __uiText("ยังไม่ได้ส่ง");},
  get pending(){return __uiText("รอตรวจสอบ");},
  get approved(){return __uiText("ยืนยันแล้ว");},
  get rejected(){return __uiText("ถูกปฏิเสธ");},
};

const STATUS_CLASS: Record<KycDocumentStatus, string> = {
  none: 'bg-gray-100 text-gray-400',
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-500',
};

export function KycStatusBadge({ status }: { status: KycDocumentStatus }) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]}`}
    >
      {status !== 'none' && <span className="h-1 w-1 rounded-full bg-current" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export default KycStatusBadge;
