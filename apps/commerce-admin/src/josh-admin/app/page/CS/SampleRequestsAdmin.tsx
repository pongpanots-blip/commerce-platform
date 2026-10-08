// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
import { getSampleRequests, updateSampleRequest } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { ErrorText } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Row = {
  id: string;
  sku: string;
  quantity: number;
  status: string;
  user_id: string;
  created_at: string;
};

export default function SampleRequestsAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const showError = (err: unknown) => setError(err instanceof Error ? err.message : __uiMessage("โหลดหรือบันทึกคำขอสินค้าตัวอย่างไม่สำเร็จ"));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await getSampleRequests();
      setRows(res?.data?.data ?? []);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: TableColumn<Row>[] = [
    { key: 'sku', label: __uiText("SKU") },
    { key: 'quantity', label: __uiText("จำนวน") },
    { key: 'status', label: __uiText("สถานะ") },
    { key: 'user_id', label: __uiText("User"), render: (v) => String(v).slice(0, 8) },
    {
      key: 'id',
      label: __uiText("จัดการ"),
      render: (id, row) =>
        row.status === 'pending' ? (
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
              onClick={() => void updateSampleRequest(id, { status: 'approved' }).then(load).catch(showError)}
            >
              {__uiText("อนุมัติ")}</button>
            <button
              type="button"
              className="rounded bg-sky-600 px-2 py-1 text-xs text-white"
              onClick={() => void updateSampleRequest(id, { status: 'fulfilled' }).then(load).catch(showError)}
            >
              {__uiText("ส่งแล้ว")}</button>
          </div>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title={__uiText("สินค้าตัวอย่าง")} subtitle={__uiText("คำขอสินค้าตัวอย่างก่อนสั่งซื้อ")} />
      {error ? <ErrorText error={error} /> : <Table columns={columns} data={rows} loading={loading} />}
    </div>
  );
}
