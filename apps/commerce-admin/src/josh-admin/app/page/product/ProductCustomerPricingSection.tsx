import {
  getProductCustomerPrices,
  type BranchSpecialPriceListItem,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';

const STATUS_LABELS: Record<BranchSpecialPriceListItem['status'], string> = {
  active: 'ใช้งาน',
  scheduled: 'รอเริ่ม',
  expired: 'หมดอายุ',
};

const STATUS_STYLES: Record<BranchSpecialPriceListItem['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  scheduled: 'bg-amber-50 text-amber-700 border-amber-200',
  expired: 'bg-gray-100 text-gray-600 border-gray-200',
};

type Props = {
  productId: string;
};

export function ProductCustomerPricingSection({ productId }: Props) {
  const [rows, setRows] = useState<BranchSpecialPriceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getProductCustomerPrices(productId)
      .then((res) => {
        if (!cancelled) setRows(res?.data ?? []);
      })
      .catch((err: { response?: { status?: number } }) => {
        if (cancelled) return;
        // The endpoint is admin-only (AdminOnlyGuard); other staff roles get 403.
        if (err?.response?.status === 403) setForbidden(true);
        else setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const columns: TableColumn<BranchSpecialPriceListItem>[] = [
    { key: 'branch_name', label: 'สาขา' },
    { key: 'company_name', label: 'ลูกค้า' },
    {
      key: 'price',
      label: 'ราคาที่กำหนด',
      render: (value) => `฿${Number(value).toLocaleString()}`,
    },
    {
      key: 'start_date',
      label: 'ช่วงเวลา',
      render: (_, row) =>
        `${row.start_date} – ${row.end_date ?? 'ไม่กำหนด'}`,
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (value: BranchSpecialPriceListItem['status']) => (
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[value]}`}
        >
          {STATUS_LABELS[value]}
        </span>
      ),
    },
  ];

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-3">ราคาตามลูกค้า</h2>
      {loading ? (
        <p className="text-sm text-gray-400">กำลังโหลด...</p>
      ) : forbidden ? (
        <p className="text-sm text-gray-400">เฉพาะผู้ดูแลระบบ</p>
      ) : failed ? (
        <p className="text-sm text-gray-400">โหลดราคาตามลูกค้าไม่สำเร็จ</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">ยังไม่มีราคาพิเศษตามลูกค้าสำหรับ SKU นี้</p>
      ) : (
        <Table columns={columns} data={rows} idKey="id" />
      )}
    </section>
  );
}

export default ProductCustomerPricingSection;
