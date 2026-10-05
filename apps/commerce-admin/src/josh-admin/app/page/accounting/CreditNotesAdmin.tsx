import {
  getCreditNote,
  listCreditNotes,
  type CreditNoteDetail,
  type CreditNoteListItem,
} from '@josh/shared-api';
import { Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

const STATUS_OPTIONS = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'active', label: 'active' },
  { value: 'exhausted', label: 'exhausted' },
  { value: 'cancelled', label: 'cancelled' },
] as const;

function money(n: number) {
  return `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
}

export default function CreditNotesAdmin() {
  const [rows, setRows] = useState<CreditNoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cnStatus, setCnStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [detail, setDetail] = useState<CreditNoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCreditNotes({
        view: 'admin',
        search: search.trim() || undefined,
        cnStatus: (cnStatus || undefined) as
          | 'active'
          | 'exhausted'
          | 'cancelled'
          | undefined,
        page,
        limit: 20,
      });
      const data = res.data?.data;
      setRows(data?.items ?? []);
      setTotalPages(data?.meta?.totalPages ?? 1);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cnStatus, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (cnId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await getCreditNote(cnId, 'admin');
      setDetail(res.data?.data ?? null);
    } catch {
      alert('โหลดรายละเอียดไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: TableColumn<CreditNoteListItem>[] = [
    { key: 'cnNumber', label: 'CN #' },
    {
      key: 'issuedFromOrderNumber',
      label: 'Order',
      render: (v) => (v as string | null) ?? '—',
    },
    {
      key: 'branchName',
      label: 'สาขา',
      render: (v) => (v as string | null) ?? '—',
    },
    {
      key: 'totalAmountExVat',
      label: 'ยอด (ex VAT)',
      render: (v) => money(Number(v)),
    },
    {
      key: 'remainingAmountExVat',
      label: 'คงเหลือ',
      render: (v) => money(Number(v)),
    },
    { key: 'cnStatus', label: 'สถานะ' },
    {
      key: 'createdAt',
      label: 'สร้างเมื่อ',
      render: (v) => new Date(String(v)).toLocaleDateString('th-TH'),
    },
    {
      key: 'cnId',
      label: '',
      render: (id) => (
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => void openDetail(String(id))}
        >
          ดู
        </button>
      ),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader
        title="Credit Notes"
        subtitle="ใบลดหนี้จากเคลม — view=admin"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            label="ค้นหาใบลดหนี้"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="ค้นหา CN # / order #"
          />
        </div>
        <div className="w-48">
          <Select
            label="สถานะ"
            value={cnStatus}
            onChange={(e) => {
              setPage(1);
              setCnStatus(e.target.value);
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => void load()}
        >
          รีเฟรช
        </button>
      </div>

      <Table
        columns={columns}
        data={rows}
        idKey="cnId"
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
      {loading ? (
        <p className="mt-2 text-sm text-gray-500">กำลังโหลด...</p>
      ) : null}

      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-800">
                {detail?.cnNumber ?? 'กำลังโหลด...'}
              </h2>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setDetail(null)}
              >
                ปิด
              </button>
            </div>
            {detailLoading && !detail ? (
              <p className="text-sm text-gray-500">กำลังโหลด...</p>
            ) : detail ? (
              <div className="space-y-3 text-sm text-gray-700">
                <p>
                  Order: {detail.issuedFromOrderNumber ?? detail.issuedFromOrderId}
                </p>
                <p>สาขา: {detail.branchName ?? '—'}</p>
                <p>
                  ยอด / คงเหลือ: {money(detail.totalAmountExVat)} /{' '}
                  {money(detail.remainingAmountExVat)}
                </p>
                <p>สถานะ: {detail.cnStatus}</p>
                {detail.claimReason ? (
                  <p>เหตุผลเคลม: {detail.claimReason}</p>
                ) : null}
                <div>
                  <p className="mb-1 font-medium text-gray-800">ประวัติการใช้</p>
                  {detail.usages.length === 0 ? (
                    <p className="text-gray-400">ยังไม่เคยใช้</p>
                  ) : (
                    <ul className="divide-y divide-gray-50">
                      {detail.usages.map((u) => (
                        <li key={u.id} className="flex justify-between py-1.5">
                          <span>
                            {u.appliedToOrderNumber ?? u.appliedToOrderId}
                          </span>
                          <span>{money(u.amountUsedExVat)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
