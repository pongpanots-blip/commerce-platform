import { getDeliveryScheduleInfo } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

type TimeSlot = {
  time_slot_id: string;
  slot_name: string;
  start_time: string;
  end_time: string;
  is_active?: boolean;
};

type ScheduleInfo = {
  description: string;
  time_slots: TimeSlot[];
  minimum_order_note: string;
  free_delivery_threshold_ex_vat: number;
};

export default function DeliveryScheduleAdmin() {
  const [info, setInfo] = useState<ScheduleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void getDeliveryScheduleInfo()
      .then((res: { data?: { data?: ScheduleInfo } }) => {
        setInfo(res?.data?.data ?? null);
      })
      .catch((err: { response?: { data?: { message?: string } }; message?: string }) => {
        setError(
          err?.response?.data?.message ?? err.message ?? 'โหลดไม่สำเร็จ',
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const columns: TableColumn<TimeSlot>[] = [
    { key: 'slot_name', label: 'ชื่อรอบ' },
    { key: 'start_time', label: 'เริ่ม' },
    { key: 'end_time', label: 'สิ้นสุด' },
  ];

  return (
    <div className="p-6">
      <AdminListHeader
        title="Delivery Schedule"
        subtitle="รอบจัดส่งและเกณฑ์จาก CS admin API"
      />

      {loading ? (
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !info ? (
        <p className="text-sm text-gray-500">ไม่มีข้อมูล</p>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
            <p>{info.description}</p>
            <p className="mt-2 text-gray-600">{info.minimum_order_note}</p>
            <p className="mt-2 font-medium">
              Free delivery threshold (ex VAT): ฿
              {Number(info.free_delivery_threshold_ex_vat).toLocaleString()}
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-800">
              รอบเวลาจัดส่งที่เปิดใช้
            </h2>
            <Table
              columns={columns}
              data={info.time_slots ?? []}
              idKey="time_slot_id"
            />
          </div>
        </div>
      )}
    </div>
  );
}
