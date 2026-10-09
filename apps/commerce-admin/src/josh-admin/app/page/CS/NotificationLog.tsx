// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  getAdminNotifications,
  type AdminNotification,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

/**
 * Read-only notification log for support (Task 11) — looks up what a
 * specific user was notified about (order updates, back-in-stock, etc.)
 * and whether they've read it. No write actions on purpose.
 */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export default function NotificationLog() {
  __useUiLocale();
  const [userIdInput, setUserIdInput] = useState('');
  const [activeUserId, setActiveUserId] = useState('');
  const [rows, setRows] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);

  const load = useCallback(
    async (userId: string, cursorValue?: string) => {
      if (!userId) {
        setRows([]);
        setNextCursor(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res: any = await getAdminNotifications({
          userId,
          cursor: cursorValue,
          limit: 20,
        });
        const payload = res?.data?.data;
        setRows(payload?.items ?? []);
        setNextCursor(payload?.nextCursor ?? null);
      } catch {
        setRows([]);
        setNextCursor(null);
        setError(__uiMessage("ไม่พบข้อมูล หรือ userId ไม่ถูกต้อง"));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeUserId) {
      void load(activeUserId, cursor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUserId, cursor]);

  const handleSearch = () => {
    const trimmed = userIdInput.trim();
    setActiveUserId(trimmed);
    setCursorStack([]);
    setCursor(undefined);
    if (trimmed) void load(trimmed, undefined);
  };

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, cursor]);
    setCursor(nextCursor);
  };

  const handlePrev = () => {
    setCursorStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setCursor(prev[prev.length - 1]);
      return next;
    });
  };

  const columns: TableColumn<AdminNotification>[] = [
    {
      key: 'created_at',
      label: __uiText("เวลา"),
      render: (value: string) =>
        new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
    },
    {
      key: 'user_id',
      label: __uiText("ผู้ใช้"),
      render: (value: string) => (
        <Link
          to={ADMIN_ROUTES.userDetail(value)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {value}
        </Link>
      ),
    },
    { key: 'type', label: __uiText("ประเภท") },
    { key: 'title', label: __uiText("หัวข้อ") },
    {
      key: 'read_at',
      label: __uiText("สถานะอ่าน"),
      render: (value: string | null) =>
        value ? (
          <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">
            {__uiText("อ่านแล้ว")}</span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-500">
            {__uiText("ยังไม่อ่าน")}</span>
        ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={__uiText("Notification Log")}
        subtitle={__uiText("ประวัติการแจ้งเตือนของผู้ใช้ (อ่านอย่างเดียว) — สำหรับทีมซัพพอร์ต")}
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 max-w-full flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("รหัสผู้ใช้ (User ID)")}</span>
          <input
            className="w-96 max-w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
          />
        </label>
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-sm text-white"
          onClick={handleSearch}
        >
          {__uiText("ค้นหา")}</button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      {!activeUserId ? (
        <p className="text-sm text-gray-400">{__uiText("ใส่ userId เพื่อดูประวัติการแจ้งเตือน")}</p>
      ) : loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : (
        <>
          <Table columns={columns} data={rows} idKey="id" />
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            <button
              type="button"
              disabled={cursorStack.length === 0}
              className="rounded border px-3 py-1 disabled:opacity-40"
              onClick={handlePrev}
            >
              {__uiText("ก่อนหน้า")}</button>
            <button
              type="button"
              disabled={!nextCursor}
              className="rounded border px-3 py-1 disabled:opacity-40"
              onClick={handleNext}
            >
              {__uiText("ถัดไป")}</button>
          </div>
        </>
      )}
    </div>
  );
}
