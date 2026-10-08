// ui-metadata-migration: static labels and UI notices only
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getSmartLinks,
  deactivateSmartLink,
  deleteSmartLink,
  type SmartLink,
  type SmartLinkListResult,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import AdminListHeader from '../../components/AdminListHeader';
import { CopyField } from '../../components/CopyField';
import { ADMIN_ROUTES } from '../../config/admin-routes';
import { ErrorText } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const REDIRECT_BASE =
  (import.meta as any).env?.VITE_SMART_LINK_BASE_URL?.replace(/\/$/, '') ||
  '/api/r';

export default function SmartLinksPage() {
  __useUiLocale();
  const navigate = useNavigate();
  const searchInputId = useId();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<SmartLinkListResult>({
    data: [],
    meta: { total: 0, page: 1, limit: 10, totalPages: 1 },
  });

  const load = async (p: number, q: string) => {
    setLoading(true);
    setError(null);
    try {
      setRes(await getSmartLinks({ page: p, search: q || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : __uiMessage("โหลดลิงก์ไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(page, search); /* eslint-disable-next-line */
  }, [page]);

  const onSearch = () => {
    setPage(1);
    void load(1, search);
  };

  const onDeactivate = async (row: SmartLink) => {
    try {
      await deactivateSmartLink(row.id);
      void load(page, search);
    } catch (err) {
      setError(err instanceof Error ? err.message : __uiMessage("ปิดลิงก์ไม่สำเร็จ"));
    }
  };
  const onDelete = async (row: SmartLink) => {
    if (!window.confirm(__uiText("ลบลิงก์ \"{0}\" ?", {"0": row.slug}))) return;
    try {
      await deleteSmartLink(row.id);
      void load(page, search);
    } catch (err) {
      setError(err instanceof Error ? err.message : __uiMessage("ลบลิงก์ไม่สำเร็จ"));
    }
  };

  const columns: TableColumn<SmartLink>[] = [
    {
      key: 'slug',
      label: __uiText("Link"),
      render: (_v, row) => (
        <div className="min-w-[220px]">
          <div className="font-semibold">{row.title || row.slug}</div>
          <CopyField label="" value={`${REDIRECT_BASE}/${row.slug}`} />
        </div>
      ),
    },
    { key: 'destination_web', label: __uiText("Web destination") },
    {
      key: 'active',
      label: __uiText("Status"),
      render: (v) => (
        <span className={v ? 'text-green-600 font-medium' : 'text-gray-400'}>
          {v ? __uiText("Active") : __uiText("Inactive")}
        </span>
      ),
    },
    {
      key: 'expires_at',
      label: __uiText("Expires"),
      render: (v) => (v ? new Date(v).toLocaleDateString() : '—'),
    },
    {
      key: 'id',
      label: __uiText("Actions"),
      render: (_v, row) => (
        <div className="flex gap-2">
          <button
            className="text-gray-600"
            onClick={() =>
              navigate(ADMIN_ROUTES.smartLinkAnalyticsDetail(row.id))
            }
          >
            {__uiText("Analytics")}</button>
          <button
            className="text-blue-600"
            onClick={() => navigate(ADMIN_ROUTES.smartLinkEdit(row.id))}
          >
            {__uiText("Edit")}</button>
          {row.active && (
            <button
              className="text-amber-600"
              onClick={() => void onDeactivate(row)}
            >
              {__uiText("Deactivate")}</button>
          )}
          <button className="text-red-600" onClick={() => void onDelete(row)}>
            {__uiText("Delete")}</button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader
        title={__uiText("Smart Links")}
        subtitle={__uiText("ลิงก์เดียวสำหรับยิง ads — เด้งตามอุปกรณ์ พร้อม tracking")}
      />
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="w-full max-w-sm">
          <label htmlFor={searchInputId} className="mb-1 block text-xs text-gray-500">
            {__uiText("ค้นหาลิงก์")}</label>
          <input
            id={searchInputId}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder={__uiText("ค้นหา slug / title")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
        </div>
        <button
          className="rounded-lg bg-gray-100 px-3 py-2 text-sm"
          onClick={onSearch}
        >
          {__uiText("ค้นหา")}</button>
        <button
          className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
          onClick={() => navigate(ADMIN_ROUTES.smartLinkCreate)}
        >
          {__uiText("+ สร้างลิงก์")}</button>
      </div>

      <div className="mt-4">
        <ErrorText error={error} />
        <Table<SmartLink>
          columns={columns}
          data={res.data}
          currentPage={res.meta.page}
          totalPages={res.meta.totalPages}
          totalItems={res.meta.total}
          pageSize={res.meta.limit}
          onPageChange={(p) => setPage(p)}
        />
        {loading && <p className="mt-2 text-xs text-gray-400">{__uiText("กำลังโหลด…")}</p>}
        {!loading && !error && res.data.length === 0 && (
          <p className="mt-6 text-center text-sm text-gray-400">
            {__uiText("ยังไม่มี smart link — กด \"สร้างลิงก์\"")}</p>
        )}
      </div>
    </div>
  );
}
