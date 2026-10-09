// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
import { getCreditApplications, updateCreditApplication } from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { ErrorText } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
  { value: '', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'PENDING', get label(){return __uiText("Pending");} },
  { value: 'REVIEW', get label(){return __uiText("Review");} },
  { value: 'REQUEST_DOC', get label(){return __uiText("Request Doc");} },
  { value: 'APPROVED', get label(){return __uiText("Approved");} },
  { value: 'REJECTED', get label(){return __uiText("Rejected");} },
];

export default function CreditTermsAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<CreditRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await getCreditApplications(status || undefined);
      setRows(res?.data?.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : __uiMessage("โหลดคำขอเครดิตไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatus = async (id: string, next: string) => {
    try {
      await updateCreditApplication(id, { status: next });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : __uiMessage("บันทึกสถานะเครดิตไม่สำเร็จ"));
    }
  };

  const columns: TableColumn<CreditRow>[] = [
    { key: 'application_id', label: __uiText("ID"), render: (v) => String(v).slice(0, 8) },
    {
      key: 'company',
      label: __uiText("บริษัท"),
      render: (_v, row) => row.company?.name ?? '-',
    },
    {
      key: 'applicant',
      label: __uiText("ผู้สมัคร"),
      render: (_v, row) => row.applicant?.email ?? '-',
    },
    {
      key: 'requested_credit_limit',
      label: __uiText("วงเงินขอ"),
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'requested_term_days', label: __uiText("เทอม (วัน)") },
    { key: 'status', label: __uiText("สถานะ") },
    {
      key: 'application_id',
      label: __uiText("จัดการ"),
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
              {__uiText("อนุมัติ")}</button>
          )}
          {row.status !== 'REQUEST_DOC' && (
            <button
              type="button"
              className="rounded bg-amber-500 px-2 py-1 text-xs text-white"
              onClick={() => void handleStatus(id, 'REQUEST_DOC')}
            >
              {__uiText("ขอเอกสารใหม่")}</button>
          )}
          {row.status !== 'REJECTED' && (
            <button
              type="button"
              className="rounded bg-rose-600 px-2 py-1 text-xs text-white"
              onClick={() => void handleStatus(id, 'REJECTED')}
            >
              {__uiText("ปฏิเสธ")}</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader title={__uiText("Credit Term แอป")} subtitle={__uiText("อนุมัติ / ขอเอกสาร / ปฏิเสธคำขอเครดิต")} />
      <div className="mb-4 w-48">
        <Select
          label={__uiText("กรองตามสถานะ")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data={STATUS_OPTIONS}
        />
      </div>
      {error ? <ErrorText error={error} /> : <Table columns={columns} data={rows} loading={loading} />}
    </div>
  );
}
