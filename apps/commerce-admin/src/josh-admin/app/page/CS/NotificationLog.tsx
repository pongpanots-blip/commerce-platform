// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  getAdminNotifications,
  type AdminNotification,
  type AdminNotificationPage,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { useAsync } from '../../../../app/hooks';
import { commerceText as text } from '../../../../app/commerce-copy';

/**
 * Read-only notification log for support (Task 11) — looks up what a
 * specific user was notified about (order updates, back-in-stock, etc.)
 * and whether they've read it. No write actions on purpose.
 */
// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, useUiLocale as __useUiLocale, Button, Chip, ErrorText, FormField, Hint, Loading } from "@cp/ui";
export default function NotificationLog() {
  __useUiLocale();
  const [userIdInput, setUserIdInput] = useState('');
  const [query, setQuery] = useState<{ userId: string; cursor?: string; revision: number }>({ userId: '', revision: 0 });
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const history = useAsync(async () => {
    const res = await getAdminNotifications({ userId: query.userId, cursor: query.cursor, limit: 20 });
    const payload = res.data?.data as AdminNotificationPage | undefined;
    if (!Array.isArray(payload?.items)) throw new Error(text('ข้อมูลประวัติการแจ้งเตือนไม่ครบ กรุณาลองอีกครั้ง', 'The notification history response is incomplete. Please try again.'));
    return payload;
  }, [query.userId, query.cursor, query.revision]);
  const rows = history.data?.items ?? [];
  const nextCursor = history.data?.nextCursor;

  const handleSearch = () => {
    const trimmed = userIdInput.trim();
    setCursorStack([]);
    setQuery(current => ({ userId: trimmed, revision: current.revision + 1 }));
  };

  const clear = () => { setUserIdInput(''); setCursorStack([]); setQuery(current => ({ userId: '', revision: current.revision + 1 })); };

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, query.cursor]);
    setQuery(current => ({ ...current, cursor: nextCursor }));
  };

  const handlePrev = () => {
    if (!cursorStack.length) return;
    setQuery(current => ({ ...current, cursor: cursorStack[cursorStack.length - 1] }));
    setCursorStack(prev => prev.slice(0, -1));
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

      <Hint>{text('แสดงรายการล่าสุดก่อน กรอกรหัสผู้ใช้เพื่อดูเฉพาะลูกค้าคนนั้น หรือเว้นว่างเพื่อดูทั้งหมด', 'Latest notifications appear first. Enter a user ID to filter by customer, or leave it blank to show all.')}</Hint>
      <form className="my-4 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); handleSearch(); }}>
        <FormField label={__uiText("รหัสผู้ใช้ (User ID)")} className="min-w-0 max-w-full">
          <input
            className="w-96 max-w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            placeholder={text('ไม่บังคับ — เว้นว่างเพื่อดูทั้งหมด', 'Optional — leave blank to show all')}
          />
        </FormField>
        <Button variant="primary" type="submit" disabled={history.loading}>
          {__uiText("ค้นหา")}</Button>
        {(query.userId || userIdInput) && <Button onClick={clear}>{text('ล้างตัวกรอง', 'Clear filters')}</Button>}
        <Button icon="refresh" onClick={history.reload} disabled={history.loading}>{__uiText('Refresh')}</Button>
      </form>

      <p className="mb-3 break-words text-sm text-on-surface-variant" role="status">{query.userId ? text(`ประวัติของผู้ใช้ ${query.userId}`, `History for user ${query.userId}`) : text('ประวัติการแจ้งเตือนล่าสุดของผู้ใช้ทั้งหมด', 'Latest notification history for all users')}</p>
      <ErrorText error={history.error} onRetry={history.reload} />

      {history.loading ? <Loading variant="table" /> : history.error ? null : (
        <>
          <Table
            columns={columns}
            data={rows}
            idKey="id"
            emptyTitle={query.userId ? __uiText("ยังไม่มีการแจ้งเตือนถึงผู้ใช้นี้") : text('ยังไม่มีประวัติการแจ้งเตือน', 'No notification history yet')}
            emptyDescription={query.userId ? __uiText("ตรวจรหัสผู้ใช้อีกครั้ง หรือลองค้นหาลูกค้าคนอื่น") : text('รายการจะปรากฏเมื่อระบบส่งการแจ้งเตือนให้ลูกค้า', 'Records appear when the system sends notifications to customers.')}
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
