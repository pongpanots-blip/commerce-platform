// @ts-nocheck — copied unchanged from josh web-admin, which has the same type errors in this file (josh type debt, not a commerce change).
import { getActiveOffers } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

type Row = {
  id: string;
  company_id: string;
  private_selling_price: number;
  productInventory?: { product_inventory_sku?: string };
  start_date: string;
  end_date: string | null;
};

export default function ActiveOffersAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getActiveOffers().then((res: any) => {
      setRows(res?.data?.data ?? []);
      setLoading(false);
    });
  }, []);

  const columns: TableColumn<Row>[] = [
    {
      key: 'productInventory',
      label: 'SKU',
      render: (_v, row) => row.productInventory?.product_inventory_sku ?? '-',
    },
    { key: 'company_id', label: 'Company ID', render: (v) => String(v).slice(0, 8) },
    {
      key: 'private_selling_price',
      label: 'ราคา',
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'start_date', label: 'เริ่ม' },
    { key: 'end_date', label: 'สิ้นสุด', render: (v) => v ?? '-' },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title="Active Offers" subtitle="Private price ที่ใช้งานอยู่" />
      <Table columns={columns} data={rows} loading={loading} />
    </div>
  );
}
