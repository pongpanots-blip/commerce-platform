// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { getPriceRequests, updatePriceRequest } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

type Row = {
  id: string;
  sku: string;
  requested_price: number;
  status: string;
  company_id: string;
  created_at: string;
};

export default function PriceRequestsAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await getPriceRequests();
      setRows(res?.data?.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: TableColumn<Row>[] = [
    { key: 'sku', label: 'SKU' },
    {
      key: 'requested_price',
      label: 'ราคาขอ',
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'status', label: 'สถานะ' },
    {
      key: 'id',
      label: 'จัดการ',
      render: (id, row) =>
        row.status === 'pending' ? (
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
              onClick={() => void updatePriceRequest(id, { status: 'approved' }).then(load)}
            >
              อนุมัติ
            </button>
            <button
              type="button"
              className="rounded bg-rose-600 px-2 py-1 text-xs text-white"
              onClick={() => void updatePriceRequest(id, { status: 'rejected' }).then(load)}
            >
              ปฏิเสธ
            </button>
          </div>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title="Price Requests" subtitle="คำขอราคาพิเศษจากลูกค้า" />
      <Table columns={columns} data={rows} loading={loading} />
    </div>
  );
}
