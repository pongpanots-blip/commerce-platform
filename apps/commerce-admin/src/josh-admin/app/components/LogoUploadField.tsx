import { DragDropUpload, Input } from '@josh/shared-ui-web';
import { uploadImage } from '@josh/shared-api';
import React, { useState } from 'react';
import { resolveAdminAssetUrl } from '../lib/asset-url';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type LogoUploadFieldProps = {
  label?: string;
  value: string;
  onChange: (url: string) => void;
};

export function LogoUploadField({
  label = 'โลโก้ / รูปภาพ',
  value,
  onChange,
}: LogoUploadFieldProps) {
  __useUiLocale();
  const [uploading, setUploading] = useState(false);

  const previewSrc = resolveAdminAssetUrl(value);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const response = await uploadImage(file);
      if (response.data?.status && response.data.data?.url) {
        onChange(response.data.data.url);
      } else {
        alert(__uiText("อัปโหลดไม่สำเร็จ"));
      }
    } catch {
      alert(__uiText("เกิดข้อผิดพลาดในการอัปโหลด"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* หัวข้อเฉย ๆ ไม่ผูก htmlFor — label ของ Input ด้านล่างเป็นตัวให้ accessible name ของช่อง URL */}
      <p className="text-sm font-semibold text-ink-secondary">{label}</p>
      <DragDropUpload
        onFileSelect={handleFile}
        accept="image/*"
        maxSizeMB={5}
      />
      {uploading && (
        <p className="text-xs text-primary animate-pulse">{__uiText("กำลังอัปโหลด...")}</p>
      )}
      <Input
        label={__uiText("หรือวาง URL รูปภาพเอง")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={__uiText("เช่น /uploads/brands/...")}
      />
      {previewSrc && (
        <img
          src={previewSrc}
          alt={__uiText("preview")}
          className="w-32 h-32 object-contain rounded-xl border border-primary-border bg-primary-soft p-2"
        />
      )}
    </div>
  );
}

export default LogoUploadField;
