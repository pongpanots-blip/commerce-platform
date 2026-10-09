// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
import { getPriceRequests, updatePriceRequest } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { ErrorText } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Row = {
  id: string;
  sku: string;
  requested_price: number;
  status: string;
  company_id: string;
  created_at: string;
};

export default function PriceRequestsAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const showError = (err: unknown) => setError(err instanceof Error ? err.message : __uiMessage("โหลดหรือบันทึกคำขอราคาไม่สำเร็จ"));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await getPriceRequests();
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
    {
      key: 'requested_price',
      label: __uiText("ราคาขอ"),
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'status', label: __uiText("สถานะ") },
    {
      key: 'id',
      label: __uiText("จัดการ"),
      render: (id, row) =>
        row.status === 'pending' ? (
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
              onClick={() => void updatePriceRequest(id, { status: 'approved' }).then(load).catch(showError)}
            >
              {__uiText("อนุมัติ")}</button>
            <button
              type="button"
              className="rounded bg-rose-600 px-2 py-1 text-xs text-white"
              onClick={() => void updatePriceRequest(id, { status: 'rejected' }).then(load).catch(showError)}
            >
              {__uiText("ปฏิเสธ")}</button>
          </div>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader title={__uiText("Price Requests")} subtitle={__uiText("คำขอราคาพิเศษจากลูกค้า")} />
      {error ? <ErrorText error={error} /> : <Table columns={columns} data={rows} loading={loading} />}
    </div>
  );
}
