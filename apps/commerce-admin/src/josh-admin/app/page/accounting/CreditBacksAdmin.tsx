// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  getCreditBack,
  listCreditBacks,
  type CreditBackDetail,
  type CreditBackListItem,
} from '@josh/shared-api';
import { Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { Button, Chip, KeyValueGrid, Modal, type Tone, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'active', get label(){return __uiText("ใช้ได้");} },
  { value: 'exhausted', get label(){return __uiText("ใช้หมดแล้ว");} },
  { value: 'cancelled', get label(){return __uiText("ยกเลิก");} },
] as const;

const STATUS_TONES: Record<string, Tone> = { active: 'ok', exhausted: 'muted', cancelled: 'danger' };

/** The label comes from josh (statusLabel); the tone follows the raw status. */
function CbStatusChip({ row }: { row: CreditBackListItem }) {
  const label = row.statusLabel || STATUS_OPTIONS.find((o) => o.value && o.value === row.cbStatus)?.label || row.cbStatus;
  return <Chip tone={STATUS_TONES[row.cbStatus] ?? 'muted'} statusCode={row.cbStatus} dot>{label}</Chip>;
}

function money(n: number) {
  return `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
}

export default function CreditBacksAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<CreditBackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cbStatus, setCbStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [detail, setDetail] = useState<CreditBackDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCreditBacks({
        view: 'admin',
        search: search.trim() || undefined,
        cbStatus: (cbStatus || undefined) as
          | 'active'
          | 'exhausted'
          | 'cancelled'
          | undefined,
        page,
        limit: 20,
      });
      const data = res.data?.data;
      setRows(data?.items ?? []);
      setTotalPages(data?.meta?.totalPages ?? 1);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cbStatus, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (cbId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await getCreditBack(cbId, 'admin');
      setDetail(res.data?.data ?? null);
    } catch {
      alert(__uiText("โหลดรายละเอียดไม่สำเร็จ"));
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: TableColumn<CreditBackListItem>[] = [
    { key: 'cbNumber', label: __uiText("เลขที่เครดิตคืน"), render: (v) => <span className="font-mono">{String(v)}</span> },
    {
      key: 'invoiceNumber',
      label: __uiText("เลขที่ใบแจ้งหนี้"),
      render: (v) => <span className="font-mono">{String(v)}</span>,
    },
    {
      key: 'issuedFromOrderNumber',
      label: __uiText("เลขที่ออเดอร์"),
      render: (v) => (v ? <span className="font-mono">{String(v)}</span> : '—'),
    },
    {
      key: 'totalAmountExVat',
      label: __uiText("ยอด (ก่อน VAT)"),
      align: 'right',
      render: (v) => money(Number(v)),
    },
    {
      key: 'remainingAmountExVat',
      label: __uiText("คงเหลือ"),
      align: 'right',
      render: (v) => money(Number(v)),
    },
    { key: 'cbStatus', label: __uiText("สถานะ"), render: (_v, row) => <CbStatusChip row={row} /> },
    {
      key: 'createdAt',
      label: __uiText("สร้างเมื่อ"),
      render: (v) => new Date(String(v)).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')),
    },
    {
      key: 'cbId',
      label: '',
      render: (id) => (
        <Button size="sm" variant="ghost" onClick={() => void openDetail(String(id))}>
          {__uiText("ดู")}</Button>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader
        title={__uiText("คืนเครดิตให้ลูกค้า")}
        subtitle={__uiText("เครดิตที่คืนให้ลูกค้าจากส่วนต่างของใบแจ้งหนี้ ดูยอดคงเหลือและประวัติการใช้")}
      >
        <Button icon="refresh" onClick={() => void load()}>{__uiText("รีเฟรช")}</Button>
      </AdminListHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            label={__uiText("ค้นหาเครดิตคืน")}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={__uiText("เลขที่เครดิตคืน / ใบแจ้งหนี้ / ออเดอร์")}
          />
        </div>
        <div className="w-48">
          <Select
            label={__uiText("สถานะ")}
            value={cbStatus}
            onChange={(e) => {
              setPage(1);
              setCbStatus(e.target.value);
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Table
        columns={columns}
        data={rows}
        idKey="cbId"
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        loading={loading}
        emptyTitle={__uiText("ยังไม่มีเครดิตคืน")}
        emptyDescription={__uiText("ลองเปลี่ยนคำค้นหาหรือสถานะ")}
      />

      {(detail || detailLoading) && (
        <Modal
          title={detail ? <span className="font-mono">{detail.cbNumber}</span> : __uiText("กำลังโหลด...")}
          onClose={() => setDetail(null)}
          width={560}
        >
          {detailLoading && !detail ? (
            <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
          ) : detail ? (
            <div className="space-y-4 text-sm">
              <KeyValueGrid
                cols={2}
                items={[
                  { label: "เลขที่ใบแจ้งหนี้", value: detail.invoiceNumber, mono: true },
                  { label: "เลขที่ออเดอร์", value: detail.issuedFromOrderNumber ?? detail.issuedFromOrderId, mono: true },
                  { label: "ร้าน", value: detail.shopName },
                  { label: "สาขา", value: detail.branchName },
                  { label: "ออกเมื่อ", value: detail.issuedDateLabel },
                  { label: "สถานะ", value: <CbStatusChip row={detail} /> },
                  { label: "ยอดออเดอร์ (ก่อน VAT)", value: money(detail.orderAmountExVat) },
                  { label: "ยอดใบแจ้งหนี้ (ก่อน VAT)", value: money(detail.invoiceAmountExVat) },
                  { label: "ยอด (ก่อน VAT)", value: money(detail.totalAmountExVat) },
                  { label: "คงเหลือ", value: money(detail.remainingAmountExVat) },
                  { label: "เหตุผล", value: detail.reason, wide: true },
                ]}
              />
              <div>
                <p className="mb-1 font-medium text-on-surface">{__uiText("ประวัติการใช้")}</p>
                {detail.usages.length === 0 ? (
                  <p className="text-gray-400">{__uiText("ยังไม่เคยใช้")}</p>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {detail.usages.map((u) => (
                      <li key={u.id} className="flex justify-between py-1.5">
                        <span className="font-mono">
                          {u.appliedToOrderNumber ?? u.appliedToOrderId}
                        </span>
                        <span className="tabular-nums">{money(u.amountUsedExVat)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </Modal>
      )}
    </div>
  );
}
