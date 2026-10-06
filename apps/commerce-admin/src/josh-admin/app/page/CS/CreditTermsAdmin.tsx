// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { getCreditApplications, updateCreditApplication } from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

type CreditRow = {
  application_id: string;
  status: string;
  requested_credit_limit: number;
  requested_term_days: number;
  company?: { name?: string };
  applicant?: { email?: string; full_name?: string };
  created_at: string;
};

const STATUS_OPTIONS = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'REVIEW', label: 'Review' },
  { value: 'REQUEST_DOC', label: 'Request Doc' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function CreditTermsAdmin() {
  const [rows, setRows] = useState<CreditRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await getCreditApplications(status || undefined);
      setRows(res?.data?.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatus = async (id: string, next: string) => {
    await updateCreditApplication(id, { status: next });
    void load();
  };

  const columns: TableColumn<CreditRow>[] = [
    { key: 'application_id', label: 'ID', render: (v) => String(v).slice(0, 8) },
    {
      key: 'company',
      label: 'บริษัท',
      render: (_v, row) => row.company?.name ?? '-',
    },
    {
      key: 'applicant',
      label: 'ผู้สมัคร',
      render: (_v, row) => row.applicant?.email ?? '-',
    },
    {
      key: 'requested_credit_limit',
      label: 'วงเงินขอ',
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'requested_term_days', label: 'เทอม (วัน)' },
    { key: 'status', label: 'สถานะ' },
    {
      key: 'application_id',
      label: 'จัดการ',
      render: (id: string, row) => (
        <div className="flex flex-wrap gap-1">
          {row.status !== 'APPROVED' && (
            <button
              type="button"
              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
              onClick={() =>
                void handleStatus(id, 'APPROVED')
              }
            >
              อนุมัติ
            </button>
          )}
          {row.status !== 'REQUEST_DOC' && (
            <button
              type="button"
              className="rounded bg-amber-500 px-2 py-1 text-xs text-white"
              onClick={() => void handleStatus(id, 'REQUEST_DOC')}
            >
              ขอเอกสารใหม่
            </button>
          )}
          {row.status !== 'REJECTED' && (
            <button
              type="button"
              className="rounded bg-rose-600 px-2 py-1 text-xs text-white"
              onClick={() => void handleStatus(id, 'REJECTED')}
            >
              ปฏิเสธ
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title="Credit Term แอป" subtitle="อนุมัติ / ขอเอกสาร / ปฏิเสธคำขอเครดิต" />
      <div className="mb-4 w-48">
        <Select
          label="กรองตามสถานะ"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data={STATUS_OPTIONS}
        />
      </div>
      <Table columns={columns} data={rows} loading={loading} />
    </div>
  );
}
