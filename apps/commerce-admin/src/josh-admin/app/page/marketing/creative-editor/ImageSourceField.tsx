import { useId, useRef, useState } from 'react';
import { uploadImage } from '@josh/shared-api';
import { Select } from '@josh/shared-ui-web';
import { resolveAdminAssetUrl } from '../../../lib/asset-url';
import type { BannerOption } from './creative-editor.types';

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none';
const LABEL_CLASS = 'mb-1 block text-[10px] font-medium text-gray-500';

/** Image source picker: banner library, pasted URL, or upload from this machine. */
export function ImageSourceField({
  value,
  onChange,
  banners,
  label,
  basePreviewValue,
}: {
  value: string;
  onChange: (url: string) => void;
  banners: BannerOption[];
  label: string;
  /** In EN mode: the Thai base image, shown as a small reference preview when the
   * overlay hasn't set its own image yet — every other field shows the Thai value
   * as a text placeholder, this is the image-picker equivalent. */
  basePreviewValue?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlInputId = useId();
  const selectId = useId();

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // Pass the image being overwritten so the backend drops the orphaned S3 object.
      const response = await uploadImage(file, value);
      const url = response?.data?.data?.url;
      if (typeof url === 'string' && url) onChange(url);
      else setError('อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
    } catch {
      setError('อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <label className={LABEL_CLASS} htmlFor={urlInputId}>
        {label}
      </label>

      {banners.length > 0 && (
        <>
          <label className={LABEL_CLASS} htmlFor={selectId}>
            เลือกจากคลัง Banner
          </label>
          <Select
            id={selectId}
            className="w-full"
            value={banners.some((b) => b.url === value.trim()) ? value.trim() : ''}
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value);
            }}
          >
            <option value="">— เลือกจากคลัง Banner (/admin/banner) —</option>
            {banners.map((banner) => (
              <option key={banner.url} value={banner.url}>
                {banner.title}
              </option>
            ))}
          </Select>
        </>
      )}

      <input
        id={urlInputId}
        type="text"
        className={`${INPUT_CLASS} font-mono`}
        placeholder="หรือวาง URL รูปเอง https://.../banner.jpg"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดจากเครื่อง'}
        </button>
        {value.trim() && (
          <img
            src={resolveAdminAssetUrl(value)}
            alt=""
            className="h-8 w-16 rounded border border-gray-200 object-cover"
          />
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        aria-label="อัปโหลดรูปจากเครื่อง"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {!value.trim() && basePreviewValue?.trim() && (
        <div className="flex items-center gap-1.5 rounded border border-dashed border-gray-200 bg-gray-50 p-1">
          <img
            src={resolveAdminAssetUrl(basePreviewValue)}
            alt=""
            className="h-6 w-12 shrink-0 rounded border border-gray-200 object-cover opacity-70"
          />
          <span className="text-[10px] text-gray-400">รูปต้นฉบับ (ไทย) — ยังไม่ได้แปล</span>
        </div>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
