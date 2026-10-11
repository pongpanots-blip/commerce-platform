// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
import { getCreditApplications, updateCreditApplication } from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { Button, Chip, ErrorText, type Tone } from '@cp/ui';

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
  { value: 'PENDING', get label(){return __uiText("รอพิจารณา");} },
  { value: 'REVIEW', get label(){return __uiText("กำลังตรวจ");} },
  { value: 'REQUEST_DOC', get label(){return __uiText("ขอเอกสารเพิ่ม");} },
  { value: 'APPROVED', get label(){return __uiText("อนุมัติแล้ว");} },
  { value: 'REJECTED', get label(){return __uiText("ปฏิเสธแล้ว");} },
];

const STATUS_TONES: Record<string, Tone> = { PENDING: 'warn', REVIEW: 'info', REQUEST_DOC: 'warn', APPROVED: 'ok', REJECTED: 'danger' };

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
    { key: 'application_id', label: __uiText("รหัสใบสมัคร"), render: (v) => <span className="font-mono">{String(v).slice(0, 8)}</span> },
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
      align: 'right',
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'requested_term_days', label: __uiText("เทอม (วัน)"), align: 'right' },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (v: string) => (
        <Chip tone={STATUS_TONES[v] ?? 'muted'} statusCode={v} dot>
          {STATUS_OPTIONS.find((o) => o.value && o.value === v)?.label ?? v}
        </Chip>
      ),
    },
    {
      key: 'application_id',
      label: __uiText("จัดการ"),
      render: (id: string, row) => (
        <div className="flex flex-wrap gap-1">
          {row.status !== 'APPROVED' && (
            <Button size="sm" icon="check" onClick={() => void handleStatus(id, 'APPROVED')}>
              {__uiText("อนุมัติ")}</Button>
          )}
          {row.status !== 'REQUEST_DOC' && (
            <Button size="sm" variant="ghost" onClick={() => void handleStatus(id, 'REQUEST_DOC')}>
              {__uiText("ขอเอกสารใหม่")}</Button>
          )}
          {row.status !== 'REJECTED' && (
            <Button
              size="sm"
              variant="danger-ghost"
              onClick={() => {
                if (!window.confirm(__uiText("ปฏิเสธใบสมัครเครดิตของ {0} หรือไม่", { 0: row.company?.name ?? row.applicant?.email ?? String(id).slice(0, 8) }))) return;
                void handleStatus(id, 'REJECTED');
              }}
            >
              {__uiText("ปฏิเสธ")}</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader title={__uiText("ใบสมัครเครดิต")} subtitle={__uiText("พิจารณาใบสมัครเครดิตเทอมของลูกค้า อนุมัติ ขอเอกสารเพิ่ม หรือปฏิเสธ")} />
      <div className="w-48">
        <Select
          label={__uiText("กรองตามสถานะ")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data={STATUS_OPTIONS}
        />
      </div>
      {error ? <ErrorText error={error} /> : <Table columns={columns} data={rows} loading={loading} emptyTitle={__uiText("ยังไม่มีใบสมัครเครดิต")} emptyDescription={__uiText("ลองเลือกสถานะอื่น")} />}
    </div>
  );
}
