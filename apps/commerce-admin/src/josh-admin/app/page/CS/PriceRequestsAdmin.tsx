// ui-metadata-migration: static labels and UI notices only
// @ts-nocheck — copied from josh web-admin; existing upstream type errors remain. Request failures are surfaced in the Commerce workspace.
import { getPriceRequests, updatePriceRequest } from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import React, { useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import { Button, Chip, ErrorText, Panel, type Tone } from '@cp/ui';

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

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'รอพิจารณา', tone: 'warn' },
  approved: { label: 'อนุมัติแล้ว', tone: 'ok' },
  rejected: { label: 'ปฏิเสธแล้ว', tone: 'danger' },
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
    { key: 'sku', label: __uiText("รหัสสินค้า"), render: (v) => <span className="font-mono text-[11px]">{v}</span> },
    {
      key: 'requested_price',
      label: __uiText("ราคาขอ"),
      align: 'right',
      render: (v) => Number(v).toLocaleString(),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (v) => <Chip tone={STATUS[v]?.tone ?? 'muted'} statusCode={v} dot>{STATUS[v] ? __uiText(STATUS[v].label) : v}</Chip>,
    },
    {
      key: 'id',
      label: __uiText("จัดการ"),
      render: (id, row) =>
        row.status === 'pending' ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void updatePriceRequest(id, { status: 'approved' }).then(load).catch(showError)}
            >
              {__uiText("อนุมัติ")}</Button>
            <Button
              size="sm"
              variant="danger-ghost"
              onClick={() => {
                if (!window.confirm(__uiText("ปฏิเสธคำขอราคาของ {0}?", { 0: row.sku }))) return;
                void updatePriceRequest(id, { status: 'rejected' }).then(load).catch(showError);
              }}
            >
              {__uiText("ปฏิเสธ")}</Button>
          </div>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader title={__uiText("คำขอราคา")} subtitle={__uiText("คำขอราคาพิเศษจากลูกค้า อนุมัติหรือปฏิเสธได้ที่นี่")} />
      {error ? <ErrorText error={error} onRetry={() => void load()} /> : (
        <Panel className="overflow-hidden">
          <Table
            columns={columns}
            data={rows}
            loading={loading}
            emptyTitle={__uiText("ยังไม่มีคำขอราคา")}
            emptyDescription={__uiText("เมื่อลูกค้าขอราคาพิเศษ คำขอจะขึ้นที่นี่")}
          />
        </Panel>
      )}
    </div>
  );
}
