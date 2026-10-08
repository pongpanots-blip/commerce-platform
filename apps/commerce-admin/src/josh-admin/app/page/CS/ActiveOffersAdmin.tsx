// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
import { getActiveOffers } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { ErrorText } from '@cp/ui';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type Row = {
  id: string;
  company_id: string;
  private_selling_price: number;
  productInventory?: { product_inventory_sku?: string };
  start_date: string;
  end_date: string | null;
};

export default function ActiveOffersAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getActiveOffers().then((res: any) => {
      setRows(res?.data?.data ?? []);
    }).catch(err => setError(err instanceof Error ? err.message : __uiMessage("โหลดราคาพิเศษไม่สำเร็จ")))
      .finally(() => setLoading(false));
  }, []);

  const columns: TableColumn<Row>[] = [
    {
      key: 'productInventory',
      label: __uiText("SKU"),
      render: (_v, row) => row.productInventory?.product_inventory_sku ?? '-',
    },
    { key: 'company_id', label: __uiText("Company ID"), render: (v) => String(v).slice(0, 8) },
    {
      key: 'private_selling_price',
      label: __uiText("ราคา"),
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'start_date', label: __uiText("เริ่ม") },
    { key: 'end_date', label: __uiText("สิ้นสุด"), render: (v) => v ?? '-' },
  ];

  return (
    <div className="p-6">
      <AdminListHeader title={__uiText("Active Offers")} subtitle={__uiText("Private price ที่ใช้งานอยู่")} />
      {error ? <ErrorText error={error} /> : <Table columns={columns} data={rows} loading={loading} />}
    </div>
  );
}
