// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { getSampleRequests, updateSampleRequest } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

type Row = {
  id: string;
  sku: string;
  quantity: number;
  status: string;
  user_id: string;
  created_at: string;
};

export default function SampleRequestsAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await getSampleRequests();
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
    { key: 'quantity', label: 'จำนวน' },
    { key: 'status', label: 'สถานะ' },
    { key: 'user_id', label: 'User', render: (v) => String(v).slice(0, 8) },
    {
      key: 'id',
      label: 'จัดการ',
      render: (id, row) =>
        row.status === 'pending' ? (
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
              onClick={() => void updateSampleRequest(id, { status: 'approved' }).then(load)}
            >
              อนุมัติ
            </button>
            <button
              type="button"
              className="rounded bg-sky-600 px-2 py-1 text-xs text-white"
              onClick={() => void updateSampleRequest(id, { status: 'fulfilled' }).then(load)}
            >
              ส่งแล้ว
            </button>
          </div>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title="สินค้าตัวอย่าง" subtitle="คำขอสินค้าตัวอย่างก่อนสั่งซื้อ" />
      <Table columns={columns} data={rows} loading={loading} />
    </div>
  );
}
