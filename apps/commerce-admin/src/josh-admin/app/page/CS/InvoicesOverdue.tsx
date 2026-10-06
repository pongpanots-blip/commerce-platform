// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { getOverdueInvoices } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

type Row = {
  invoice_id: string;
  invoice_number: string;
  due_date: string;
  is_paid: boolean;
  order?: { order_number?: string; user?: { email?: string } };
};

export default function InvoicesOverdue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getOverdueInvoices().then((res: any) => {
      setRows(res?.data?.data ?? []);
      setLoading(false);
    });
  }, []);

  const columns: TableColumn<Row>[] = [
    { key: 'invoice_number', label: 'Invoice #' },
    {
      key: 'order',
      label: 'Order',
      render: (_v, row) => row.order?.order_number ?? '-',
    },
    {
      key: 'order',
      label: 'ลูกค้า',
      render: (_v, row) => row.order?.user?.email ?? '-',
    },
    { key: 'due_date', label: 'ครบกำหนด' },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title="Invoice Overdue" subtitle="ใบแจ้งหนี้เลยกำหนดชำระ" />
      <Table columns={columns} data={rows} loading={loading} />
    </div>
  );
}
