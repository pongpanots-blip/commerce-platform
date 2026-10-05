import {
  exportUsersCsv,
  getUsers,
  getUserSegments,
  type UserSegmentListItem,
} from '@josh/shared-api';
import { Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AiOutlineDownload, AiOutlineEye } from 'react-icons/ai';
import AdminListHeader from '../../components/AdminListHeader';
import { RevealPiiButton } from '../../components/RevealPiiButton';
import { ADMIN_ROUTES } from '../../config/admin-routes';

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
  company: 'ค้าง: กรอกบริษัท',
  shop: 'ค้าง: กรอกร้าน',
  branch: 'ค้าง: กรอกสาขา',
};

const PAGE_SIZE = 20;

const Alluser = () => {
  const navigate = useNavigate();
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

  const selectedSegment = segments.find((segment) => segment.id === segmentId);

  const onboardingOptions = [
    { value: '', label: 'ทั้งหมด' },
    { value: 'complete', label: 'สมัครเสร็จ' },
    { value: 'incomplete', label: 'สมัครไม่เสร็จ' },
  ];
  const selectedOnboardingLabel = onboardingOptions.find(
    (option) => option.value === onboarding,
  )?.label;

  const columns: TableColumn<UserRow>[] = [
    {
      key: 'custcode',
      label: 'Cust Code',
      render: (_, row) => (
        <div className="text-xs leading-5">
          <div className="font-semibold text-gray-800">{row.custcode ?? '-'}</div>
          {row.legacy_custcode && (
            <div className="text-gray-400">Legacy: {row.legacy_custcode}</div>
          )}
        </div>
      ),
    },
    {
      key: 'full_name',
      label: 'ชื่อลูกค้า',
      render: (_, row) => (
        <div>
          <div className="font-medium text-gray-800">{row.full_name}</div>
          <div className="text-xs text-gray-400">
            <RevealPiiButton subjectType="user" subjectId={row.id} field="email" masked={row.email} />
          </div>
        </div>
      ),
    },
    {
      key: 'mobile_phone',
      label: 'เบอร์โทร',
      render: (value, row) => (
        <RevealPiiButton subjectType="user" subjectId={row.id} field="mobile_phone" masked={value} />
      ),
    },
    {
      key: 'company',
      label: 'Company',
      render: (_, row) =>
        row.company ? (
          <div className="text-xs leading-5">
            <div className="font-medium text-gray-800">{row.company.name}</div>
            <div className="text-gray-400">
              {row.company.register_number ?? 'ไม่มีเลขทะเบียน'}
            </div>
          </div>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      key: 'branch_count',
      label: 'Branch',
      render: (_, row) => (
        <button
          type="button"
          onClick={() =>
            setExpandedId(expandedId === row.id ? null : row.id)
          }
          className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
        >
          {row.branch_count} สาขา
        </button>
      ),
    },
    {
      key: 'custype',
      label: 'Cuisine / Type',
      render: (value) => (
        <span className="line-clamp-2 max-w-[180px] text-xs text-gray-600">
          {value ?? '-'}
        </span>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (value) => (
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-600">
          {value}
        </span>
      ),
    },
    {
      key: 'onboarding_step',
      label: 'สถานะสมัคร',
      render: (_, row) =>
        row.onboarding_completed ? (
          <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">
            เสร็จ
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
            {ONBOARDING_STEP_LABELS[row.onboarding_step] ?? row.onboarding_step}
          </span>
        ),
    },
    {
      key: 'actions',
      label: 'เครื่องมือ',
      render: (_, row) => (
        <button
          type="button"
          onClick={() => navigate(ADMIN_ROUTES.userDetail(row.id))}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 hover:text-primary"
          title="ดู Dashboard ลูกค้า"
        >
          <AiOutlineEye size={18} />
          View
        </button>
      ),
    },
  ];

  const expandedUser = apiResponse.data.find((row) => row.id === expandedId);
  const totalItems = Number(apiResponse.meta.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  return (
    <div className="grid mx-auto w-full gap-5 p-4">
      <AdminListHeader
        title="All Users"
        subtitle={`รายชื่อลูกค้า B2B · แสดง ${PAGE_SIZE} รายการต่อหน้า${search ? ` · ค้นหา: "${search}"` : ''}${selectedSegment ? ` · Segment: ${selectedSegment.name}` : ''}${onboarding ? ` · สถานะสมัคร: ${selectedOnboardingLabel}` : ''}`}
      >
        <div className="flex flex-wrap items-end gap-2">
          <form onSubmit={handleSearch} className="flex items-end gap-2">
            <Input
              label="ค้นหาผู้ใช้"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="ค้นหา ชื่อ, email, custcode, เบอร์โทร, company..."
            />
            <button
              type="submit"
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              ค้นหา
            </button>
            {search && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                ล้าง
              </button>
            )}
          </form>

          <div className="w-64">
            <Select
              label="กรองตาม Segment"
              data={segmentOptions}
              placeholder="กรองตาม Segment"
              value={segmentId}
              onChange={(event) => {
                setSegmentId(event.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          {segmentId && (
            <button
              type="button"
              onClick={handleClearSegment}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              ล้าง Segment
            </button>
          )}

          <div className="w-48">
            <Select
              label="สถานะสมัคร"
              data={onboardingOptions}
              value={onboarding}
              onChange={(event) => {
                setOnboarding(event.target.value as '' | 'complete' | 'incomplete');
                setCurrentPage(1);
              }}
            />
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AiOutlineDownload size={16} />
            {exporting ? 'กำลัง Export...' : 'Export CSV'}
          </button>
        </div>
      </AdminListHeader>

      {expandedUser && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800">
                สาขาของ {expandedUser.full_name}
              </h2>
              <p className="text-xs text-gray-500">
                Company: {expandedUser.company?.name ?? '-'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExpandedId(null)}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              ปิด
            </button>
          </div>

          {expandedUser.branches.length === 0 ? (
            <p className="text-sm text-gray-500">ไม่มีสาขา</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {expandedUser.branches.map((branch) => (
                <div
                  key={branch.id}
                  className="rounded-lg border border-white bg-white p-3 shadow-sm"
                >
                  <div className="font-medium text-gray-800">{branch.name}</div>
                  {branch.type && (
                    <div className="mt-1 text-xs text-blue-600">{branch.type}</div>
                  )}
                  <div className="mt-2 text-xs leading-5 text-gray-500">
                    {branch.delivery_address || 'ไม่มีที่อยู่จัดส่ง'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        {loading && (
          <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">
            กำลังโหลด...
          </div>
        )}
        <Table
          columns={columns}
          data={apiResponse.data}
          idKey="id"
          totalItems={totalItems}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={PAGE_SIZE}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
};

export default Alluser;
