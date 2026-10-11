// ui-metadata-migration: static labels and UI notices only
import { Chip, type Tone, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import { KycCustomerType, KycDocumentStatus } from './kyc.types';

const STATUS_LABEL: Record<KycDocumentStatus, string> = {
  get none(){return __uiText("ยังไม่ได้ส่ง");},
  get pending(){return __uiText("รอตรวจสอบ");},
  get approved(){return __uiText("ยืนยันแล้ว");},
  get rejected(){return __uiText("ถูกปฏิเสธ");},
};

const STATUS_TONE: Record<KycDocumentStatus, Tone> = {
  none: 'muted',
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
};

export function KycStatusBadge({ status }: { status: KycDocumentStatus }) {
  __useUiLocale();
  return (
    <Chip tone={STATUS_TONE[status]} statusCode={status} dot={status !== 'none'}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

const CUSTOMER_TYPE: Record<KycCustomerType, string> = { B2B: 'ลูกค้าธุรกิจ', B2C: 'ลูกค้าทั่วไป' };

/** Customer type shown by label; the stored value stays B2B/B2C. */
export const customerTypeLabel = (type: KycCustomerType) => (CUSTOMER_TYPE[type] ? __uiText(CUSTOMER_TYPE[type]) : type);

export default KycStatusBadge;
