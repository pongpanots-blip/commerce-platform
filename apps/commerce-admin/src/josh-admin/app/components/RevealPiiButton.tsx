// ui-metadata-migration: static labels and UI notices only
import { revealPii, type PiiField, type PiiSubjectType } from '@josh/shared-api';
import { useId, useState } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
interface RevealPiiButtonProps {
  subjectType: PiiSubjectType;
  subjectId: string;
  field: PiiField;
  /** The masked value shown until the user asks for the real one. */
  masked: string | null;
  /** Optional label rendered before the mask, e.g. "เบอร์โทร:". */
  label?: string;
}

const MIN_REASON_LENGTH = 10;

export function RevealPiiButton({
  subjectType,
  subjectId,
  field,
  masked,
  label,
}: RevealPiiButtonProps) {
  __useUiLocale();
  const [value, setValue] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonId = useId();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await revealPii({ subjectType, subjectId, fields: [field], reason });
      setValue(result[field] ?? '—');
      setAsking(false);
      setReason('');
    } catch {
      setError(__uiMessage("ขอดูข้อมูลไม่สำเร็จ กรุณาลองใหม่"));
    } finally {
      setBusy(false);
    }
  };

  if (value) {
    const isPhone = field === 'mobile_phone' || field === 'phone' || field === 'mobile';
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        {label && <span className="text-gray-500">{label}</span>}
        <span className="font-medium text-gray-900">{value}</span>
        {isPhone && value !== '—' && (
          <a href={`tel:${value}`} className="text-primary hover:underline">
            {__uiText("โทร")}</a>
        )}
      </span>
    );
  }

  const canReveal = masked != null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      {label && <span className="text-gray-500">{label}</span>}
      <span className="text-gray-900">{masked ?? '—'}</span>
      {canReveal && !asking && (
        <button
          type="button"
          className="rounded border border-gray-200 px-2 py-1 text-xs font-medium text-primary hover:bg-gray-50"
          onClick={() => setAsking(true)}
        >
          {__uiText("ขอดูข้อมูลเต็ม")}</button>
      )}
      {canReveal && asking && (
        <span className="inline-flex flex-wrap items-center gap-2">
          <label htmlFor={reasonId} className="text-xs text-gray-500">
            {__uiText("เหตุผล")}</label>
          <input
            id={reasonId}
            className="rounded border border-gray-200 px-2 py-1 text-xs"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={__uiText("อย่างน้อย 10 ตัวอักษร")}
          />
          <button
            type="button"
            disabled={busy || reason.trim().length < MIN_REASON_LENGTH}
            className="rounded bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? __uiText("กำลังขอข้อมูล…") : __uiText("ยืนยัน")}
          </button>
          <button
            type="button"
            className="rounded border border-gray-200 px-2 py-1 text-xs"
            onClick={() => {
              setAsking(false);
              setReason('');
              setError(null);
            }}
          >
            {__uiText("ยกเลิก")}</button>
          {error && (
            <span role="alert" className="text-xs text-red-600">
              {(typeof error === 'string' ? __uiText(error) : error)}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
