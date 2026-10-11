// ui-metadata-migration: static labels and UI notices only
import { getDeliveryScheduleInfo } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, KeyValueGrid, Panel, PanelHead, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
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
  __useUiLocale();
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
          err?.response?.data?.message ?? err.message ?? __uiMessage("โหลดไม่สำเร็จ"),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const columns: TableColumn<TimeSlot>[] = [
    { key: 'slot_name', label: __uiText("ชื่อรอบ") },
    { key: 'start_time', label: __uiText("เริ่ม"), render: (v) => <span className="tabular-nums">{String(v)}</span> },
    { key: 'end_time', label: __uiText("สิ้นสุด"), render: (v) => <span className="tabular-nums">{String(v)}</span> },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader
        title={__uiText("ตารางรอบส่ง")}
        subtitle={__uiText("รอบเวลาจัดส่งที่เปิดใช้ และเกณฑ์ยอดสั่งซื้อขั้นต่ำและส่งฟรี")}
      />

      {loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : error ? (
        <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>
      ) : !info ? (
        <p className="text-sm text-gray-500">{__uiText("ไม่มีข้อมูล")}</p>
      ) : (
        <div className="space-y-5">
          <Panel>
            <PanelHead title={__uiText("เกณฑ์การจัดส่ง")} />
            <div className="p-5">
              <KeyValueGrid
                cols={3}
                items={[
                  { label: "ยอดขั้นต่ำสำหรับส่งฟรี (ก่อน VAT)", value: `฿${Number(info.free_delivery_threshold_ex_vat).toLocaleString()}` },
                  { label: "ยอดสั่งซื้อขั้นต่ำ", value: info.minimum_order_note, wide: true },
                  { label: "รายละเอียด", value: info.description, wide: true },
                ]}
              />
            </div>
          </Panel>

          <div>
            <h2 className="mb-2 text-[15px] font-semibold text-on-surface">
              {__uiText("รอบเวลาจัดส่งที่เปิดใช้")}</h2>
            <Table
              columns={columns}
              data={info.time_slots ?? []}
              idKey="time_slot_id"
              emptyTitle={__uiText("ยังไม่มีรอบเวลาจัดส่งที่เปิดใช้")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
