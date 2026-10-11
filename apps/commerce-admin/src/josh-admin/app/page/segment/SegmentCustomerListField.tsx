import { resolveSegmentUsers } from '@josh/shared-api';
import { Textarea } from '@josh/shared-ui-web';
import React, { useRef, useState } from 'react';
import {
  parseCouponRecipientCsv,
  parseRecipientTokens,
  rowsToImportPayload,
  type CsvImportRow,
} from '../coupon/coupon-import.helpers';
import { manualUsersNotFoundWarning, type ManualUsersLoadStatus } from './segment-rule.helpers';
import { mergeResolvedUsers, type ResolvedSegmentUser } from './segment-user-list.helpers';

/** Status of resolving a segment's already-saved `user_ids` (edit page only — a fresh/create
 * list has nothing to load). While this isn't 'loaded', the page must block Save. */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export type ManualUsersInitialLoad = {
  status: ManualUsersLoadStatus;
  /** How many of the stored ids came back in `not_found` (stale/deleted users). */
  notFoundCount: number;
  onRetry: () => void;
};

type Props = {
  value: ResolvedSegmentUser[];
  onChange: (next: ResolvedSegmentUser[]) => void;
  /** Present only on the edit page, for a segment that was already `manual_user_list`. */
  initialLoad?: ManualUsersInitialLoad;
};

// One identifier per row is enough; every column is optional. Example values are fake.
const TEMPLATE_CSV = [
  'user_id,email,custcode',
  ',somchai@example.com,',
  ',,CUST001',
  '123e4567-e89b-12d3-a456-426614174000,,',
].join('\n');
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;
const LIST_PREVIEW_LIMIT = 20;
const NOT_FOUND_PREVIEW_LIMIT = 10;

/** CSV/paste → resolveSegmentUsers → merged list of {id, email, name} for the manual_user_list
 * card. `email`/`name` may come back masked (e.g. `na***@joshcompany.com`) from the backend —
 * this component only displays and dedupes by `id`, never tries to unmask. */
export function SegmentCustomerListField({ value, onChange, initialLoad }: Props) {
  __useUiLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileRows, setFileRows] = useState<CsvImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [fileError, setFileError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [lastResult, setLastResult] = useState<{ found: number; notFound: string[] } | null>(null);

  const handleFile = async (file: File) => {
    setFileError('');
    try {
      const rows = parseCouponRecipientCsv(await file.text());
      if (rows.length === 0) {
        setFileError(__uiMessage("ไม่พบข้อมูลในไฟล์"));
        return;
      }
      setFileRows(rows);
      setFileName(file.name);
    } catch {
      setFileError(__uiMessage("อ่านไฟล์ไม่สำเร็จ"));
    }
  };

  const handleCheck = async () => {
    const tokens: CsvImportRow[] = [...fileRows, ...parseRecipientTokens(pasteText)];
    if (tokens.length === 0) return;
    setChecking(true);
    setCheckError('');
    try {
      const payload = rowsToImportPayload(tokens);
      const { users, not_found } = await resolveSegmentUsers(payload);
      onChange(mergeResolvedUsers(value, users));
      setLastResult({ found: users.length, notFound: not_found });
      setPasteText('');
      setFileRows([]);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setCheckError(__uiMessage("ตรวจสอบรายชื่อไม่สำเร็จ"));
    } finally {
      setChecking(false);
    }
  };

  const removeUser = (id: string) => onChange(value.filter((user) => user.id !== id));

  return (
    <div className="space-y-3">
      {initialLoad?.status === 'loading' && (
        <p className="text-xs text-gray-500">{__uiText("กำลังโหลดรายชื่อเดิม...")}</p>
      )}
      {initialLoad?.status === 'error' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/20 bg-danger-container px-3 py-2 text-xs text-danger"
        >
          <span>{__uiText("โหลดรายชื่อเดิมไม่สำเร็จ — กดลองใหม่")}</span>
          <button
            type="button"
            onClick={initialLoad.onRetry}
            className="font-medium text-danger underline hover:text-red-800"
          >
            {__uiText("ลองใหม่")}</button>
        </div>
      )}
      {initialLoad?.status === 'loaded' && manualUsersNotFoundWarning(initialLoad.notFoundCount) && (
        <p className="text-xs text-warn">
          {manualUsersNotFoundWarning(initialLoad.notFoundCount)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-black text-primary transition-colors hover:bg-primary/20">
          <span>{__uiText("อัปโหลด CSV")}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.tsv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
        <a
          href={TEMPLATE_HREF}
          download="segment-users-template.csv"
          className="text-xs text-blue-600 hover:underline"
        >
          {__uiText("ดาวน์โหลด template")}</a>
        {fileName && (
          <span className="text-xs text-gray-500">
            {__uiText("ไฟล์ ")}{fileName}: {fileRows.length} {__uiText(" รายการ")}</span>
        )}
      </div>
      <p className="text-xs text-gray-500">
        {__uiText("คอลัมน์ ")}<code>{__uiText("user_id")}</code>, <code>{__uiText("email")}</code>, <code>{__uiText("custcode")}</code> {__uiText(" — ไม่บังคับทุกช่อง แต่ละแถวใส่อย่างน้อย 1 ช่อง (ไม่มีหัวคอลัมน์ก็ได้ ระบบเดาจากรูปแบบ)")}</p>
      {fileError && (
        <p role="alert" className="text-xs text-danger">
          {(typeof (fileError) === 'string' ? __uiText(fileError) : fileError)}
        </p>
      )}

      <Textarea
        label={__uiText("หรือวาง email / user_id / custcode (คั่นด้วย comma หรือขึ้นบรรทัดใหม่)")}
        rows={3}
        value={pasteText}
        onChange={(event) => setPasteText(event.target.value)}
      />

      <button
        type="button"
        onClick={() => void handleCheck()}
        disabled={checking || (fileRows.length === 0 && !pasteText.trim())}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {checking ? __uiText("กำลังตรวจสอบ...") : __uiText("ตรวจสอบรายชื่อ")}
      </button>
      {checkError && (
        <p role="alert" className="text-xs text-danger">
          {(typeof (checkError) === 'string' ? __uiText(checkError) : checkError)}
        </p>
      )}
      {lastResult && (
        <p className="text-xs text-gray-500">
          {__uiText("พบ ")}{lastResult.found} {__uiText(" คน · ไม่พบ ")}{lastResult.notFound.length}
          {lastResult.notFound.length > 0
            ? ` (${lastResult.notFound.slice(0, NOT_FOUND_PREVIEW_LIMIT).join(', ')}${
                lastResult.notFound.length > NOT_FOUND_PREVIEW_LIMIT
                  ? ` +${lastResult.notFound.length - NOT_FOUND_PREVIEW_LIMIT}`
                  : ''
              })`
            : ''}
        </p>
      )}

      <div className="rounded-lg border border-gray-100 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-gray-700">{__uiText("รายชื่อ: ")}{value.length} {__uiText(" คน")}</span>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-danger hover:underline"
            >
              {__uiText("ล้างรายการ")}</button>
          )}
        </div>
        {value.length === 0 ? (
          <p className="text-xs text-gray-400">{__uiText("ยังไม่มีรายชื่อ")}</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {value.slice(0, LIST_PREVIEW_LIMIT).map((user) => (
              <li key={user.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-gray-700">{user.email}</span>
                <button
                  type="button"
                  onClick={() => removeUser(user.id)}
                  aria-label={__uiText("นำ {0} ออก", {"0": user.email})}
                  className="text-gray-400 hover:text-alert"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {value.length > LIST_PREVIEW_LIMIT && (
          <p className="mt-1 text-xs text-gray-400">+{value.length - LIST_PREVIEW_LIMIT} {__uiText(" คน")}</p>
        )}
      </div>
    </div>
  );
}

export default SegmentCustomerListField;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
