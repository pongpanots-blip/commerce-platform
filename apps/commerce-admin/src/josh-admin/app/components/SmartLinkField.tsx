import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getOrCreateSmartLinkForEntity,
  type SmartLinkEntityResult,
} from '@josh/shared-api';
import { ADMIN_ROUTES } from '../config/admin-routes';
import { CopyField } from './CopyField';

const PUBLIC_BASE =
  (import.meta as any).env?.VITE_SMART_LINK_BASE_URL?.replace(/\/$/, '') || '/api/r';

type Props = {
  type: 'product' | 'cuisine' | 'promotion' | 'custom';
  id?: string;
  path?: string;
  /** ข้อความปุ่ม (default: "สร้าง Smart Link (self-host)") */
  buttonLabel?: string;
};

/**
 * ปุ่มสร้าง self-hosted Smart Link แบบ lazy — กดแล้ว backend getOrCreate ลิงก์ /r/<slug>
 * ประจำ entity นั้น (1 entity = 1 ลิงก์ถาวร, analytics สะสมที่เดียว).
 */
export function SmartLinkField({
  type,
  id,
  path,
  buttonLabel = 'สร้าง Smart Link (self-host)',
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SmartLinkEntityResult | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await getOrCreateSmartLinkForEntity({ type, id, path }));
    } catch {
      setError('สร้างลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง');
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
          {loading ? 'กำลังสร้าง…' : buttonLabel}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  const publicUrl = `${PUBLIC_BASE}/${result.slug}`;

  return (
    <div className="grid grid-cols-1 gap-3">
      <CopyField label="Smart Link (self-host)" value={publicUrl} />
      {!result.originConfigured && (
        <p className="text-xs text-amber-600">
          ยังไม่ได้ตั้ง PUBLIC_WEB_ORIGIN ที่ backend — ปลายทางยังเป็น path ล้วน
          ตั้งค่าก่อนนำไปใช้ยิงจริง
        </p>
      )}
      <Link
        to={ADMIN_ROUTES.smartLinkAnalyticsDetail(result.smartLinkId)}
        className="justify-self-start text-xs text-blue-600 underline hover:text-blue-800"
      >
        ดู Analytics ลิงก์นี้
      </Link>
    </div>
  );
}

export default SmartLinkField;
