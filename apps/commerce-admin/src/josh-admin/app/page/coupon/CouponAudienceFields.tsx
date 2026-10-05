import { Link, useLocation } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import {
  getUserSegments,
  previewUserSegmentCount,
  type UserSegmentListItem,
} from '@josh/shared-api';
import { Select, Textarea } from '@josh/shared-ui-web';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { appendReturnTo } from '../../utils/return-to';
import { useStashCouponDraftOnClick } from './coupon-form-draft.helpers';
import CouponOptionToggle from './CouponOptionToggle';
import {
  COUPON_AUDIENCE_MODES,
  pendingRecipientRows,
  type CouponAudienceForm,
} from './coupon-audience.helpers';
import { parseCouponRecipientCsv, rowsToImportPayload } from './coupon-import.helpers';

type Props = {
  value: CouponAudienceForm;
  onChange: (next: CouponAudienceForm) => void;
  disabled?: boolean;
  codeGeneration: 'shared' | 'unique_suffix';
  onCodeGenerationChange: (next: 'shared' | 'unique_suffix') => void;
  /** true once the coupon has any entitlement or usage (`coupon.code_locked`) — changing
   * code_generation is a code change too, so this toggle locks along with the coupon code. */
  codeGenerationLocked?: boolean;
};

export function CouponAudienceFields({
  value,
  onChange,
  disabled,
  codeGeneration,
  onCodeGenerationChange,
  codeGenerationLocked,
}: Props) {
  const location = useLocation();
  const stashDraftOnClick = useStashCouponDraftOnClick();
  const modeSelectId = React.useId();
  const segmentSelectId = React.useId();
  const recipientFileId = React.useId();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [segments, setSegments] = useState<UserSegmentListItem[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [fileError, setFileError] = useState('');

  const patch = (partial: Partial<CouponAudienceForm>) => {
    onChange({ ...value, ...partial });
  };

  // Load segments when the segment mode is active.
  useEffect(() => {
    if (value.mode !== 'segment' || segments.length > 0) return;
    let cancelled = false;
    setLoadingSegments(true);
    getUserSegments()
      .then((list) => {
        if (!cancelled) setSegments(list ?? []);
      })
      .catch(() => {
        if (!cancelled) setSegments([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSegments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [value.mode, segments.length]);

  // The parent clears recipientFile after a successful save — the native file input keeps
  // showing the old filename otherwise, and re-picking the same file fires no change event.
  useEffect(() => {
    if (!value.recipientFile && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [value.recipientFile]);

  // Preview member count for the selected segment.
  useEffect(() => {
    if (value.mode !== 'segment' || !value.segmentId) {
      setMemberCount(null);
      return;
    }
    let cancelled = false;
    previewUserSegmentCount(value.segmentId)
      .then((count) => {
        if (!cancelled) setMemberCount(count ?? null);
      })
      .catch(() => {
        if (!cancelled) setMemberCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value.mode, value.segmentId]);

  // Hide throwaway coupon-* segments, except the one currently selected.
  const options = segments.filter(
    (s) =>
      s.is_active &&
      (!s.slug.startsWith('coupon-') || s.id === value.segmentId),
  );

  const selectedMode = COUPON_AUDIENCE_MODES.find((m) => m.value === value.mode);
  const recipientCount =
    value.mode === 'manual'
      ? (() => {
          const payload = rowsToImportPayload(pendingRecipientRows(value));
          return payload.user_ids.length + payload.emails.length + payload.custcodes.length;
        })()
      : 0;

  const handleRecipientFile = async (file: File) => {
    setFileError('');
    try {
      const rows = parseCouponRecipientCsv(await file.text());
      if (rows.length === 0) {
        setFileError('ไม่พบข้อมูลในไฟล์');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      patch({ recipientFile: { name: file.name, rows } });
    } catch {
      setFileError('อ่านไฟล์ไม่สำเร็จ');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearRecipientFile = () => {
    patch({ recipientFile: null });
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <div>
        <Select
          id={modeSelectId}
          label="รูปแบบกลุ่มเป้าหมาย"
          className="w-full"
          value={value.mode}
          disabled={disabled}
          onChange={(event) =>
            patch({ mode: event.target.value as CouponAudienceForm['mode'] })
          }
        >
          {COUPON_AUDIENCE_MODES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {selectedMode && (
          <p className="mt-1 text-xs text-gray-400">{selectedMode.hint}</p>
        )}
      </div>

      {value.mode === 'segment' && (
        <div className="space-y-2">
          <Select
            id={segmentSelectId}
            label="เลือก segment"
            className="w-full"
            value={value.segmentId ?? ''}
            disabled={disabled || loadingSegments}
            onChange={(event) =>
              patch({ segmentId: event.target.value || null })
            }
          >
            <option value="">
              {loadingSegments ? 'กำลังโหลด…' : '— เลือก segment —'}
            </option>
            {options.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </Select>

          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">
              {value.segmentId && memberCount != null
                ? `ประมาณ ${memberCount.toLocaleString()} คน`
                : ''}
            </span>
            <Link
              to={appendReturnTo(ADMIN_ROUTES.segmentCreate, location.pathname)}
              onClick={stashDraftOnClick}
              className="text-violet-700 hover:underline"
            >
              + สร้าง segment ใหม่
            </Link>
          </div>

          <p className="text-xs text-gray-500">
            ระบบจะตรวจว่าลูกค้ายังอยู่ใน segment ตอนใช้คูปอง
          </p>
        </div>
      )}

      {value.mode === 'new_signup' && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-3 text-xs text-violet-900">
          ระบบจะมอบสิทธิ์คูปองให้<strong>ทุกคนที่สมัครสำเร็จ</strong>ทันที (email signup / Google ครั้งแรก)
          — ไม่ต้องสร้างรายชื่อหรือ segment แยก
        </div>
      )}

      {value.mode === 'manual' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor={recipientFileId} className="text-xs text-gray-500">
              ไฟล์รายชื่อ (CSV/TSV)
            </label>
            <input
              id={recipientFileId}
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv"
              className="text-sm"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleRecipientFile(file);
              }}
            />
            <a
              href="data:text/csv;charset=utf-8,email%2Ccustcode%0Auser1%40example.com%2CCUST001"
              download="coupon-recipients-template.csv"
              className="text-xs text-blue-600 hover:underline"
            >
              ดาวน์โหลด template
            </a>
          </div>
          {fileError && (
            <p role="alert" className="text-xs text-red-600">
              {fileError}
            </p>
          )}
          {value.recipientFile && (
            <p className="flex items-center gap-2 text-xs text-gray-600">
              ไฟล์ {value.recipientFile.name}: {value.recipientFile.rows.length} รายการ
              <button
                type="button"
                className="text-blue-600 hover:underline"
                disabled={disabled}
                onClick={clearRecipientFile}
              >
                ลบไฟล์
              </button>
            </p>
          )}
          <Textarea
            label="หรือวาง user_id / email / custcode (คั่นด้วย comma หรือขึ้นบรรทัดใหม่)"
            rows={3}
            value={value.recipientText}
            disabled={disabled}
            onChange={(event) => patch({ recipientText: event.target.value })}
          />
          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${recipientCount === 0 ? 'text-amber-700' : 'text-gray-500'}`}
          >
            {recipientCount === 0
              ? 'ยังไม่มีรายชื่อ — คูปองนี้จะยังไม่มีใครใช้ได้จนกว่าจะเพิ่มรายชื่อ'
              : `จะเพิ่ม ${recipientCount} รายชื่อเมื่อกดบันทึก`}
          </p>
        </div>
      )}

      {value.mode !== 'all' && (
        <CouponOptionToggle
          checked={codeGeneration === 'unique_suffix'}
          disabled={disabled || codeGenerationLocked}
          onChange={(checked) => onCodeGenerationChange(checked ? 'unique_suffix' : 'shared')}
          title="สร้างรหัสเฉพาะต่อคน (ต่อท้ายรหัสหลัก)"
          description={
            codeGenerationLocked
              ? 'มีการแจกหรือใช้คูปองนี้แล้ว — เปลี่ยนรูปแบบรหัสไม่ได้'
              : 'ลูกค้าแต่ละคนได้รหัสไม่ซ้ำกัน เช่น SUMMER-7F3K'
          }
        />
      )}
    </div>
  );
}

export default CouponAudienceFields;
