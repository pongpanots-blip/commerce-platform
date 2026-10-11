// ui-metadata-migration: static labels and UI notices only
import {
  exportUsersCsv,
  getUsers,
  getUserSegments,
  type UserSegmentListItem,
} from '@josh/shared-api';
import { Input, Select, Table, TableColumn, TableViewBar, useTableViews } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { RevealPiiButton } from '../../components/RevealPiiButton';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { Button, ButtonLink, Chip, Panel, PanelHead, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type BranchItem = {
  id: string;
  name: string;
  type: string | null;
  delivery_address: string | null;
};

type UserRow = {
  id: string;
  full_name: string;
  email: string;
  custcode: string | null;
  legacy_custcode: string | null;
  mobile_phone: string | null;
  custype: string | null;
  role: string;
  company: {
    id: string;
    name: string;
    register_number: string | null;
  } | null;
  branches: BranchItem[];
  branch_count: number;
  created_at: string;
  onboarding_completed: boolean;
  onboarding_step: 'complete' | 'company' | 'shop' | 'branch';
};

const ONBOARDING_STEP_LABELS: Record<string, string> = {
  get company(){return __uiText("ค้าง: กรอกบริษัท");},
  get shop(){return __uiText("ค้าง: กรอกร้าน");},
  get branch(){return __uiText("ค้าง: กรอกสาขา");},
};

const ROLE_LABELS: Record<string, string> = {
  get super_admin(){return __uiText("ผู้ดูแลหลัก");},
  get staff(){return __uiText("พนักงาน");},
};

const PAGE_SIZE = 20;

const Alluser = () => {
  __useUiLocale();
  const [searchParams] = useSearchParams();
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [onboarding, setOnboarding] = useState<'' | 'complete' | 'incomplete'>('');
  const [segments, setSegments] = useState<UserSegmentListItem[]>([]);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [apiResponse, setApiResponse] = useState<{
    data: UserRow[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }>({
    data: [],
    meta: { total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 },
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response: any = await getUsers({
        page: currentPage,
        limit: PAGE_SIZE,
        search: search || undefined,
        segment_id: segmentId || undefined,
        onboarding: onboarding || undefined,
        sortKey: 'created_at',
        sortOrder: 'DESC',
      });

      if (response?.status === 200 && response.data?.status === true) {
        setApiResponse(response.data.data);
      }
    } catch (error: any) {
      console.error('load users error:', error.message);
    } finally {
      setLoading(false);
    }
  }, [currentPage, search, segmentId, onboarding]);

  useEffect(() => {
    getUserSegments()
      .then((items) => setSegments(items.filter((item) => item.is_active)))
      .catch((error: Error) => {
        console.error('load segments error:', error.message);
      });
  }, []);

  useEffect(() => {
    const segmentFromUrl = searchParams.get('segment');
    if (segmentFromUrl) {
      setSegmentId(segmentFromUrl);
      setCurrentPage(1);
    }
    const onboardingFromUrl = searchParams.get('onboarding');
    if (onboardingFromUrl === 'complete' || onboardingFromUrl === 'incomplete') {
      setOnboarding(onboardingFromUrl);
      setCurrentPage(1);
    }
  }, [searchParams]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setCurrentPage(1);
    setSearch(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
    setCurrentPage(1);
  };

  const handleClearSegment = () => {
    setSegmentId('');
    setCurrentPage(1);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const blob = await exportUsersCsv({
        search: search || undefined,
        segment_id: segmentId || undefined,
        onboarding: onboarding || undefined,
        sortKey: 'created_at',
        sortOrder: 'DESC',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'export failed';
      console.error('export users csv error:', message);
    } finally {
      setExporting(false);
    }
  };

  const segmentOptions = useMemo(
    () =>
      segments.map((segment) => ({
        value: segment.id,
        label: `${segment.name} (${segment.slug})`,
      })),
    [segments],
  );

  const onboardingOptions = [
    { value: '', label: __uiText("ทั้งหมด") },
    { value: 'complete', label: __uiText("สมัครเสร็จ") },
    { value: 'incomplete', label: __uiText("สมัครไม่เสร็จ") },
  ];

  const columns: TableColumn<UserRow>[] = [
    {
      key: 'custcode',
      label: __uiText("รหัสลูกค้า"),
      render: (_, row) => (
        <div className="font-mono text-[11px] leading-5">
          <div className="font-semibold text-on-surface">{row.custcode ?? '-'}</div>
          {row.legacy_custcode && (
            <div className="text-on-surface-variant">{__uiText("รหัสเดิม: ")}{row.legacy_custcode}</div>
          )}
        </div>
      ),
    },
    {
      key: 'full_name',
      label: __uiText("ชื่อลูกค้า"),
      render: (_, row) => (
        <div>
          <div className="font-medium text-on-surface">{row.full_name}</div>
          <div className="text-xs text-on-surface-variant">
            <RevealPiiButton subjectType="user" subjectId={row.id} field="email" masked={row.email} />
          </div>
        </div>
      ),
    },
    {
      key: 'mobile_phone',
      label: __uiText("เบอร์โทร"),
      render: (value, row) => (
        <RevealPiiButton subjectType="user" subjectId={row.id} field="mobile_phone" masked={value} />
      ),
    },
    {
      key: 'company',
      label: __uiText("บริษัท"),
      render: (_, row) =>
        row.company ? (
          <div className="text-xs leading-5">
            <div className="font-medium text-on-surface">{row.company.name}</div>
            <div className={row.company.register_number ? 'font-mono text-[11px] text-on-surface-variant' : 'text-on-surface-variant'}>
              {row.company.register_number ?? __uiText("ไม่มีเลขทะเบียน")}
            </div>
          </div>
        ) : (
          <span className="text-on-surface-variant">-</span>
        ),
    },
    {
      key: 'branch_count',
      label: __uiText("สาขา"),
      align: 'right',
      render: (_, row) => (
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expandedId === row.id}
          onClick={() =>
            setExpandedId(expandedId === row.id ? null : row.id)
          }
        >
          <span className="tabular-nums">{row.branch_count}</span> {__uiText(" สาขา")}</Button>
      ),
    },
    {
      key: 'custype',
      label: __uiText("ประเภทร้าน"),
      render: (value) => (
        <span className="line-clamp-2 max-w-[180px] text-xs text-on-surface-variant">
          {value ?? '-'}
        </span>
      ),
    },
    {
      key: 'role',
      label: __uiText("บทบาท"),
      render: (value) => <Chip statusCode={value}>{ROLE_LABELS[value] ?? value}</Chip>,
    },
    {
      key: 'onboarding_step',
      label: __uiText("สถานะสมัคร"),
      render: (_, row) =>
        row.onboarding_completed ? (
          <Chip tone="ok" dot>{__uiText("เสร็จ")}</Chip>
        ) : (
          <Chip tone="warn" statusCode={row.onboarding_step} dot>
            {ONBOARDING_STEP_LABELS[row.onboarding_step] ?? row.onboarding_step}
          </Chip>
        ),
    },
    {
      key: 'actions',
      label: __uiText("เครื่องมือ"),
      render: (_, row) => (
        <ButtonLink to={ADMIN_ROUTES.userDetail(row.id)} icon="visibility">
          {__uiText("ดูรายละเอียด")}</ButtonLink>
      ),
    },
  ];

  const expandedUser = apiResponse.data.find((row) => row.id === expandedId);
  const totalItems = Number(apiResponse.meta.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const views = useTableViews('j-allusers', { search, segmentId, onboarding }, (v) => {
    setSearch(v.search ?? '');
    setSearchInput(v.search ?? '');
    setSegmentId(v.segmentId ?? '');
    setOnboarding(v.onboarding ?? '');
    setCurrentPage(1);
  });

  return (
    <div className="cp-management-page grid w-full gap-5">
      <AdminListHeader
        title={__uiText("ผู้ใช้ของลูกค้า")}
        subtitle={__uiText("ค้นหาบัญชีผู้ใช้ของลูกค้า ดูบริษัท สาขา และสถานะการสมัคร")}
      >
        <Button
          icon="download"
          onClick={handleExportCsv}
          disabled={exporting || loading}
        >
          {exporting ? __uiText("กำลังเตรียมไฟล์...") : __uiText("ดาวน์โหลดไฟล์ CSV")}
        </Button>
      </AdminListHeader>

      <div className="flex flex-wrap items-end gap-2">
        <form onSubmit={handleSearch} className="flex items-end gap-2">
          <Input
            label={__uiText("ค้นหาผู้ใช้")}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={__uiText("ชื่อ อีเมล รหัสลูกค้า เบอร์โทร หรือบริษัท")}
          />
          <Button type="submit" icon="search">
            {__uiText("ค้นหา")}</Button>
          {search && (
            <Button variant="ghost" onClick={handleClearSearch}>
              {__uiText("ล้าง")}</Button>
          )}
        </form>

        <div className="w-64">
          <Select
            label={__uiText("กลุ่มลูกค้า")}
            data={segmentOptions}
            placeholder={__uiText("ทุกกลุ่มลูกค้า")}
            value={segmentId}
            onChange={(event) => {
              setSegmentId(event.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
        {segmentId && (
          <Button variant="ghost" onClick={handleClearSegment}>
            {__uiText("ล้างกลุ่มลูกค้า")}</Button>
        )}

        <div className="w-48">
          <Select
            label={__uiText("สถานะสมัคร")}
            data={onboardingOptions}
            value={onboarding}
            onChange={(event) => {
              setOnboarding(event.target.value as '' | 'complete' | 'incomplete');
              setCurrentPage(1);
            }}
          />
        </div>
      </div>

      {expandedUser && (
        <Panel className="overflow-hidden">
          <PanelHead
            icon="storefront"
            title={<>{__uiText("สาขาของ ")}{expandedUser.full_name}</>}
            sub={<>{__uiText("บริษัท: ")}{expandedUser.company?.name ?? '-'}</>}
            actions={<Button size="sm" variant="ghost" icon="close" onClick={() => setExpandedId(null)}>{__uiText("ปิด")}</Button>}
          />
          <div className="p-4">
            {expandedUser.branches.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{__uiText("ไม่มีสาขา")}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {expandedUser.branches.map((branch) => (
                  <div
                    key={branch.id}
                    className="rounded-lg border border-secondary-container p-3"
                  >
                    <div className="font-medium text-on-surface">{branch.name}</div>
                    {branch.type && (
                      <div className="mt-1 text-xs text-on-surface-variant">{branch.type}</div>
                    )}
                    <div className="mt-2 text-xs leading-5 text-on-surface-variant">
                      {branch.delivery_address || __uiText("ไม่มีที่อยู่จัดส่ง")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel className="overflow-hidden">
        <div className="border-b border-secondary-container px-4 py-2">
          <TableViewBar views={views} columns={columns} />
        </div>
        <Table
          columns={columns}
          data={apiResponse.data}
          idKey="id"
          hiddenKeys={views.hidden}
          totalItems={totalItems}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={PAGE_SIZE}
          onPageChange={setCurrentPage}
          loading={loading}
          emptyTitle={__uiText("ไม่พบผู้ใช้")}
          emptyDescription={search || segmentId || onboarding ? __uiText("ลองเปลี่ยนคำค้นหรือล้างตัวกรอง") : undefined}
        />
      </Panel>
    </div>
  );
};

export default Alluser;
