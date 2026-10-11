import { DragDropUpload } from '@josh/shared-ui-web';
import React, { useMemo } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL) ||
  'https://joshapp.io/api';

type CouponImageFieldProps = {
  imageUrl?: string | null;
  pendingFile: File | null;
  onPendingFileChange: (file: File | null) => void;
  disabled?: boolean;
};

export default function CouponImageField({
  imageUrl,
  pendingFile,
  onPendingFileChange,
  disabled = false,
}: CouponImageFieldProps) {
  __useUiLocale();
  const previewSrc = useMemo(() => {
    if (pendingFile) {
      return URL.createObjectURL(pendingFile);
    }
    if (!imageUrl) return '';
    return imageUrl.startsWith('http') ? imageUrl : `${API_BASE}${imageUrl}`;
  }, [imageUrl, pendingFile]);

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        {__uiText("รูปคูปอง")}</label>
      <DragDropUpload
        onFileSelect={(file) => onPendingFileChange(file)}
        accept="image/*"
        maxSizeMB={5}
      />
      {disabled && (
        <p className="text-xs text-gray-400">{__uiText("กำลังบันทึก...")}</p>
      )}
      {previewSrc && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
          <p className="mb-2 text-xs text-gray-500">{__uiText("ตัวอย่างรูปคูปอง")}</p>
          <img
            src={previewSrc}
            alt={__uiText("Coupon preview")}
            className="h-40 w-full max-w-sm rounded-lg border object-cover"
          />
          {pendingFile && !disabled && (
            <button
              type="button"
              className="mt-2 text-xs text-danger hover:underline"
              onClick={() => onPendingFileChange(null)}
            >
              {__uiText("ลบรูปที่เลือก")}</button>
          )}
        </div>
      )}
      <p className="text-xs text-gray-500">
        {__uiText("รองรับ JPG, PNG, WebP สูงสุด 5MB — แสดงในกระเป๋าคูปองของลูกค้า")}</p>
    </div>
  );
}
