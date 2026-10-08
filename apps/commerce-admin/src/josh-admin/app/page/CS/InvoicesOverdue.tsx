// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
import { getOverdueInvoices } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { ErrorText } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Row = {
  invoice_id: string;
  invoice_number: string;
  due_date: string;
  is_paid: boolean;
  order?: { order_number?: string; user?: { email?: string } };
};

export default function InvoicesOverdue() {
  __useUiLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getOverdueInvoices().then((res: any) => {
      setRows(res?.data?.data ?? []);
    }).catch(err => setError(err instanceof Error ? err.message : __uiMessage("โหลดใบแจ้งหนี้ไม่สำเร็จ")))
      .finally(() => setLoading(false));
  }, []);

  const columns: TableColumn<Row>[] = [
    { key: 'invoice_number', label: __uiText("Invoice #") },
    {
      key: 'order',
      label: __uiText("Order"),
      render: (_v, row) => row.order?.order_number ?? '-',
    },
    {
      key: 'order',
      label: __uiText("ลูกค้า"),
      render: (_v, row) => row.order?.user?.email ?? '-',
    },
    { key: 'due_date', label: __uiText("ครบกำหนด") },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title={__uiText("Invoice Overdue")} subtitle={__uiText("ใบแจ้งหนี้เลยกำหนดชำระ")} />
      {error ? <ErrorText error={error} /> : <Table columns={columns} data={rows} loading={loading} />}
    </div>
  );
}
