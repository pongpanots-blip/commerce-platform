// ui-static-options-migration: display metadata; identifiers remain unchanged
import { uiText } from '@cp/ui';
/**
 * KYC queue types — UI-only for now.
 *
 * These mirror what the real backend module (being built in parallel) is
 * expected to return, so swapping useKycQueue()'s mock implementation for a
 * real API call later should not require touching the page/modal components.
 */

export type KycDocumentStatus = 'none' | 'pending' | 'approved' | 'rejected';

export type KycDocumentType = 'id_card' | 'selfie' | 'storefront';

export const KYC_DOCUMENT_TYPES: { key: KycDocumentType; label: string; thumbnailLabel: string }[] = [
  { key: 'id_card', get label(){return uiText("บัตรประจำตัวประชาชน");}, get thumbnailLabel(){return uiText("บัตรประชาชน");} },
  { key: 'selfie', get label(){return uiText("เซลฟี่ถือบัตรประชาชน");}, get thumbnailLabel(){return uiText("เซลฟี่ถือบัตร");} },
  { key: 'storefront', get label(){return uiText("รูปหน้าร้าน / สถานประกอบการ");}, get thumbnailLabel(){return uiText("หน้าร้าน");} },
];

export interface KycDocument {
  status: KycDocumentStatus;
  submittedAt?: string; // ISO timestamp — undefined when status is 'none'
  decidedAt?: string; // ISO timestamp — set when status is 'approved' or 'rejected'
  rejectionReason?: string; // only set when status is 'rejected'
  thumbnailUrl?: string | null; // signed URL to the uploaded document image, when available
}

export type KycCustomerType = 'B2C' | 'B2B';

export interface KycQueueEntry {
  id: string;
  companyName: string;
  customerType: KycCustomerType;
  documents: Record<KycDocumentType, KycDocument>;
}
