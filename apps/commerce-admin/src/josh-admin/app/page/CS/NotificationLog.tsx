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
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Button, Chip, Empty, FormField } from "@cp/ui";
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
        setError(__uiMessage("ไม่พบข้อมูล หรือรหัสผู้ใช้ไม่ถูกต้อง"));
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
      render: (value: string) => (
        <span className="whitespace-nowrap tabular-nums">
          {new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      ),
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
    {
      key: 'type',
      label: __uiText("ประเภท"),
      render: (value: string) => <Chip className="font-mono">{value}</Chip>,
    },
    { key: 'title', label: __uiText("หัวข้อ") },
    {
      key: 'read_at',
      label: __uiText("สถานะอ่าน"),
      render: (value: string | null) =>
        value ? (
          <Chip tone="ok" dot>{__uiText("อ่านแล้ว")}</Chip>
        ) : (
          <Chip tone="muted" dot>{__uiText("ยังไม่อ่าน")}</Chip>
        ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={__uiText("ประวัติการแจ้งเตือน")}
        subtitle={__uiText("บันทึกการแจ้งเตือนที่ส่งถึงลูกค้า")}
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <FormField label={__uiText("รหัสผู้ใช้ (User ID)")} className="min-w-0 max-w-full">
          <input
            className="w-96 max-w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
          />
        </FormField>
        <Button variant="primary" onClick={handleSearch}>
          {__uiText("ค้นหา")}</Button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      {!activeUserId ? (
        <Empty icon="search">{__uiText("ใส่รหัสผู้ใช้แล้วกดค้นหา เพื่อดูประวัติการแจ้งเตือนของลูกค้าคนนั้น")}</Empty>
      ) : loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : (
        <>
          <Table
            columns={columns}
            data={rows}
            idKey="id"
            emptyTitle={__uiText("ยังไม่มีการแจ้งเตือนถึงผู้ใช้นี้")}
            emptyDescription={__uiText("ตรวจรหัสผู้ใช้อีกครั้ง หรือลองค้นหาลูกค้าคนอื่น")}
          />
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            <Button size="sm" disabled={cursorStack.length === 0} onClick={handlePrev}>
              {__uiText("ก่อนหน้า")}</Button>
            <Button size="sm" disabled={!nextCursor} onClick={handleNext}>
              {__uiText("ถัดไป")}</Button>
          </div>
        </>
      )}
    </div>
  );
}
