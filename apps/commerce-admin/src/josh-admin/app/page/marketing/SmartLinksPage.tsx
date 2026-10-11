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
import { Button, ErrorText, SearchInput, StatusChip, fmt } from '@cp/ui';

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
    if (!window.confirm(__uiText("ปิดลิงก์ \"{0}\"? คนที่กดลิงก์นี้จะไปต่อไม่ได้", {"0": row.slug}))) return;
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
      label: __uiText("ลิงก์"),
      render: (_v, row) => (
        <div className="min-w-[220px]">
          <div className="font-semibold">{row.title || row.slug}</div>
          <CopyField label="" value={`${REDIRECT_BASE}/${row.slug}`} />
        </div>
      ),
    },
    {
      key: 'destination_web',
      label: __uiText("ปลายทางบนเว็บ"),
      render: (v) => (v ? <span className="font-mono text-xs break-all">{v}</span> : '—'),
    },
    {
      key: 'active',
      label: __uiText("สถานะ"),
      render: (v) => <StatusChip status={v ? 'active' : 'inactive'} />,
    },
    {
      key: 'expires_at',
      label: __uiText("หมดอายุ"),
      align: 'right',
      render: (v) => <span className="tabular-nums whitespace-nowrap">{v ? fmt.date(v) : '—'}</span>,
    },
    {
      key: 'id',
      label: '',
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon="bar_chart" onClick={() => navigate(ADMIN_ROUTES.smartLinkAnalyticsDetail(row.id))}>
            {__uiText("ดูผล")}</Button>
          <Button size="sm" variant="ghost" icon="edit" onClick={() => navigate(ADMIN_ROUTES.smartLinkEdit(row.id))}>
            {__uiText("แก้ไข")}</Button>
          {row.active && (
            <Button size="sm" variant="danger-ghost" onClick={() => void onDeactivate(row)}>
              {__uiText("ปิดลิงก์")}</Button>
          )}
          <Button size="sm" variant="danger-ghost" icon="delete" onClick={() => void onDelete(row)}>
            {__uiText("ลบ")}</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader
        title={__uiText("ลิงก์ติดตามผล")}
        subtitle={__uiText("ลิงก์เดียวใช้ได้ทุกที่ พาลูกค้าไปหน้าที่เลือกตามเครื่องที่ใช้ และนับคนกดให้")}
        createLabel={__uiText("สร้างลิงก์")}
        createPath={ADMIN_ROUTES.smartLinkCreate}
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full max-w-sm">
          <label htmlFor={searchInputId} className="mb-1 block text-xs font-medium text-gray-600">
            {__uiText("ค้นหาลิงก์")}</label>
          <SearchInput
            id={searchInputId}
            placeholder={__uiText("ค้นหาจากชื่อหรือท้ายลิงก์")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
        </div>
        <Button onClick={onSearch}>{__uiText("ค้นหา")}</Button>
      </div>

      <div>
        <ErrorText error={error} />
        <Table<SmartLink>
          columns={columns}
          data={res.data}
          loading={loading}
          currentPage={res.meta.page}
          totalPages={res.meta.totalPages}
          totalItems={res.meta.total}
          pageSize={res.meta.limit}
          onPageChange={(p) => setPage(p)}
          emptyTitle={search ? __uiText("ไม่พบลิงก์ที่ค้นหา") : __uiText("ยังไม่มีลิงก์ติดตามผล")}
          emptyDescription={search ? __uiText("ลองค้นด้วยคำอื่น") : __uiText("กด \"สร้างลิงก์\" เพื่อสร้างลิงก์แรก")}
        />
      </div>
    </div>
  );
}
