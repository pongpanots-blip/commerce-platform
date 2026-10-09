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
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'active', get label(){return __uiText("active");} },
  { value: 'exhausted', get label(){return __uiText("exhausted");} },
  { value: 'cancelled', get label(){return __uiText("cancelled");} },
] as const;

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
    { key: 'cbNumber', label: __uiText("CB #") },
    {
      key: 'invoiceNumber',
      label: __uiText("Invoice"),
    },
    {
      key: 'issuedFromOrderNumber',
      label: __uiText("Order"),
      render: (v) => (v as string | null) ?? '—',
    },
    {
      key: 'totalAmountExVat',
      label: __uiText("ยอด (ex VAT)"),
      render: (v) => money(Number(v)),
    },
    {
      key: 'remainingAmountExVat',
      label: __uiText("คงเหลือ"),
      render: (v) => money(Number(v)),
    },
    { key: 'cbStatus', label: __uiText("สถานะ"), render: (v, row) => row.statusLabel ?? String(v) },
    {
      key: 'createdAt',
      label: __uiText("สร้างเมื่อ"),
      render: (v) => new Date(String(v)).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')),
    },
    {
      key: 'cbId',
      label: '',
      render: (id) => (
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline"
          onClick={() => void openDetail(String(id))}
        >
          {__uiText("ดู")}</button>
      ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={__uiText("Credit Backs")}
        subtitle={__uiText("เครดิตคืนจากส่วนต่าง invoice — view=admin")}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Input
            label={__uiText("ค้นหาเครดิตคืน")}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={__uiText("ค้นหา CB # / invoice / order #")}
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
        <button
          type="button"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => void load()}
        >
          {__uiText("รีเฟรช")}</button>
      </div>

      <Table
        columns={columns}
        data={rows}
        idKey="cbId"
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
      {loading ? (
        <p className="mt-2 text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : null}

      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-800">
                {detail?.cbNumber ?? __uiText("กำลังโหลด...")}
              </h2>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setDetail(null)}
              >
                {__uiText("ปิด")}</button>
            </div>
            {detailLoading && !detail ? (
              <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
            ) : detail ? (
              <div className="space-y-3 text-sm text-gray-700">
                <p>{__uiText("Invoice: ")}{detail.invoiceNumber}</p>
                <p>
                  {__uiText("Order: ")}{detail.issuedFromOrderNumber ?? detail.issuedFromOrderId}
                </p>
                <p>
                  {__uiText("Shop / สาขา: ")}{detail.shopName ?? '—'} /{' '}
                  {detail.branchName ?? '—'}
                </p>
                <p>{__uiText("ออกเมื่อ: ")}{detail.issuedDateLabel ?? '—'}</p>
                <p>
                  {__uiText("Order / Invoice amount: ")}{money(detail.orderAmountExVat)} /{' '}
                  {money(detail.invoiceAmountExVat)}
                </p>
                <p>
                  {__uiText("ยอด / คงเหลือ: ")}{money(detail.totalAmountExVat)} /{' '}
                  {money(detail.remainingAmountExVat)}
                </p>
                <p>
                  {__uiText("สถานะ: ")}{detail.statusLabel} ({detail.applicationStatus})
                </p>
                <p>{__uiText("เหตุผล: ")}{detail.reason}</p>
                <div>
                  <p className="mb-1 font-medium text-gray-800">{__uiText("ประวัติการใช้")}</p>
                  {detail.usages.length === 0 ? (
                    <p className="text-gray-400">{__uiText("ยังไม่เคยใช้")}</p>
                  ) : (
                    <ul className="divide-y divide-gray-50">
                      {detail.usages.map((u) => (
                        <li key={u.id} className="flex justify-between py-1.5">
                          <span>
                            {u.appliedToOrderNumber ?? u.appliedToOrderId}
                          </span>
                          <span>{money(u.amountUsedExVat)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
