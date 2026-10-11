// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  getCreditNote,
  listCreditNotes,
  type CreditNoteDetail,
  type CreditNoteListItem,
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

function CnStatusChip({ status }: { status: string }) {
  const label = STATUS_OPTIONS.find((o) => o.value && o.value === status)?.label ?? status;
  return <Chip tone={STATUS_TONES[status] ?? 'muted'} statusCode={status} dot>{label}</Chip>;
}

function money(n: number) {
  return `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
}

export default function CreditNotesAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<CreditNoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cnStatus, setCnStatus] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [detail, setDetail] = useState<CreditNoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCreditNotes({
        view: 'admin',
        search: search.trim() || undefined,
        cnStatus: (cnStatus || undefined) as
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
  }, [cnStatus, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (cnId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await getCreditNote(cnId, 'admin');
      setDetail(res.data?.data ?? null);
    } catch {
      alert(__uiText("โหลดรายละเอียดไม่สำเร็จ"));
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: TableColumn<CreditNoteListItem>[] = [
    { key: 'cnNumber', label: __uiText("เลขที่ใบลดหนี้"), render: (v) => <span className="font-mono">{String(v)}</span> },
    {
      key: 'issuedFromOrderNumber',
      label: __uiText("เลขที่ออเดอร์"),
      render: (v) => (v ? <span className="font-mono">{String(v)}</span> : '—'),
    },
    {
      key: 'branchName',
      label: __uiText("สาขา"),
      render: (v) => (v as string | null) ?? '—',
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
    { key: 'cnStatus', label: __uiText("สถานะ"), render: (v) => <CnStatusChip status={String(v)} /> },
    {
      key: 'createdAt',
      label: __uiText("สร้างเมื่อ"),
      render: (v) => new Date(String(v)).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')),
    },
    {
      key: 'cnId',
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
        title={__uiText("ใบลดหนี้")}
        subtitle={__uiText("ใบลดหนี้ที่ออกจากการเคลมสินค้า ดูยอดคงเหลือและประวัติการใช้")}
      >
        <Button icon="refresh" onClick={() => void load()}>{__uiText("รีเฟรช")}</Button>
      </AdminListHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            label={__uiText("ค้นหาใบลดหนี้")}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={__uiText("เลขที่ใบลดหนี้ / เลขที่ออเดอร์")}
          />
        </div>
        <div className="w-48">
          <Select
            label={__uiText("สถานะ")}
            value={cnStatus}
            onChange={(e) => {
              setPage(1);
              setCnStatus(e.target.value);
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
        idKey="cnId"
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        loading={loading}
        emptyTitle={__uiText("ยังไม่มีใบลดหนี้")}
        emptyDescription={__uiText("ลองเปลี่ยนคำค้นหาหรือสถานะ")}
      />

      {(detail || detailLoading) && (
        <Modal
          title={detail ? <span className="font-mono">{detail.cnNumber}</span> : __uiText("กำลังโหลด...")}
          onClose={() => setDetail(null)}
        >
          {detailLoading && !detail ? (
            <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
          ) : detail ? (
            <div className="space-y-4 text-sm">
              <KeyValueGrid
                cols={2}
                items={[
                  { label: "เลขที่ออเดอร์", value: detail.issuedFromOrderNumber ?? detail.issuedFromOrderId, mono: true },
                  { label: "สาขา", value: detail.branchName },
                  { label: "ยอด (ก่อน VAT)", value: money(detail.totalAmountExVat) },
                  { label: "คงเหลือ", value: money(detail.remainingAmountExVat) },
                  { label: "สถานะ", value: <CnStatusChip status={detail.cnStatus} /> },
                  ...(detail.claimReason ? [{ label: "เหตุผลเคลม", value: detail.claimReason, wide: true }] : []),
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
