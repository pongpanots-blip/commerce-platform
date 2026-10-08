// ui-metadata-migration: static labels and UI notices only
import { useState } from 'react';
import {
  getMarketingDeeplink,
  type MarketingLinkParams,
  type MarketingLinkResult,
} from '@josh/shared-api';
import { CopyField } from './CopyField';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Props = {
  type: MarketingLinkParams['type'];
  id?: string;
  path?: string;
  utm?: MarketingLinkParams['utm'];
  /** ข้อความปุ่ม (default: "สร้างลิงก์ Marketing") */
  buttonLabel?: string;
};

/**
 * ปุ่มสร้าง marketing deep link (ChottuLink) แบบ lazy — กดแล้วค่อยยิง backend
 * (ไม่สร้างลิงก์ทุกครั้งที่เปิดหน้า; backend cache ให้ครั้งถัดไปคืนทันที).
 */
export function MarketingLinkField({
  type,
  id,
  path,
  utm,
  buttonLabel = 'สร้างลิงก์ Marketing',
}: Props) {
  __useUiLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingLinkResult | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMarketingDeeplink({ type, id, path, utm });
      setResult(res);
    } catch {
      setError(__uiMessage("สร้างลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง"));
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {loading ? __uiText("กำลังสร้าง…") : buttonLabel}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      <CopyField label={__uiText("ลิงก์ Marketing (ยิง ads)")} value={result.shortUrl} />
      {result.webUrl !== result.shortUrl && (
        <CopyField label={__uiText("Web URL (ปลายทาง)")} value={result.webUrl} />
      )}
      {result.provider === 'fallback' && (
        <p className="text-xs text-amber-600">
          {__uiText("ยังไม่ได้ตั้งค่า ChottuLink — ลิงก์นี้เป็น web URL ตรง (ใช้ได้เลย) จะกลายเป็น short link อัตโนมัติเมื่อใส่ CHOTTULINK_API_KEY ที่ backend")}</p>
      )}
      <button
        type="button"
        onClick={() => void generate()}
        disabled={loading}
        className="justify-self-start text-xs text-gray-400 underline hover:text-gray-600"
      >
        {loading ? __uiText("กำลังรีเฟรช…") : __uiText("รีเฟรช")}
      </button>
    </div>
  );
}

export default MarketingLinkField;
