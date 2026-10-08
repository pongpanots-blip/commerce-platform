// ui-metadata-migration: static labels and UI notices only
import {
  bulkDeletePrivatePrices,
  createCompanyPrivatePrice,
  deletePrivatePrice,
  getCompanyPrivatePrices,
  importCompanyPrivatePricesCsv,
  type PrivatePriceListItem,
  updatePrivatePrice,
} from '@josh/shared-api';
import { DateRangeInput, Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_LABELS: Record<PrivatePriceListItem['status'], string> = {
  get active(){return __uiText("ใช้งาน");},
  get scheduled(){return __uiText("รอเริ่ม");},
  get expired(){return __uiText("หมดอายุ");},
};

const STATUS_STYLES: Record<PrivatePriceListItem['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  scheduled: 'bg-amber-50 text-amber-700 border-amber-200',
  expired: 'bg-gray-100 text-gray-600 border-gray-200',
};

type Props = {
  companyId: string;
  branches?: Array<{ id: string; name: string }>;
};

/** Company-level special / private price (Customer SKU → private_price). */
export function CompanySpecialPricingPanel({ companyId, branches = [] }: Props) {
  __useUiLocale();
  const [rows, setRows] = useState<PrivatePriceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sku: '',
    price: '',
    branch_id: '',
    start_date: '',
    end_date: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getCompanyPrivatePrices(companyId);
      setRows(res?.data ?? []);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message ?? __uiMessage("โหลดราคาพิเศษไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(__uiText("ลบราคาพิเศษ {0} รายการ?", {"0": selectedIds.length}))) return;
    await bulkDeletePrivatePrices(selectedIds);
    setSelectedIds([]);
    await load();
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const res = await importCompanyPrivatePricesCsv(companyId, file);
      const errors = res?.data?.errors as string[] | undefined;
      if (errors?.length) {
        setError(errors.slice(0, 3).join(' · '));
      }
      await load();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message ?? __uiMessage("นำเข้า CSV ไม่สำเร็จ"));
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(form.price);
    if (!form.sku.trim() || Number.isNaN(price)) {
      setError(__uiMessage("กรุณาระบุ SKU และราคา"));
      return;
    }

    setSaving(true);
    setError('');
    try {
      await createCompanyPrivatePrice(companyId, {
        sku: form.sku.trim(),
        private_selling_price: price,
        branch_id: form.branch_id || undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      });
      setForm({ sku: '', price: '', branch_id: '', start_date: '', end_date: '' });
      await load();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : undefined;
      setError(message ?? __uiMessage("บันทึกราคาพิเศษไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<PrivatePriceListItem>[] = [
    {
      key: 'id',
      label: '',
      render: (_, row) => (
        <input
          type="checkbox"
          aria-label={__uiText("เลือกราคาพิเศษของ {0}", {"0": row.sku})}
          checked={selectedIds.includes(row.id)}
          onChange={() => toggleSelect(row.id)}
        />
      ),
    },
    { key: 'sku', label: __uiText("SKU") },
    { key: 'product_name', label: __uiText("ชื่อสินค้า") },
    {
      key: 'private_selling_price',
      label: __uiText("ราคาพิเศษ"),
      render: (value, row) => (
        <button
          type="button"
          className="font-semibold text-primary hover:underline"
          onClick={async () => {
            const next = window.prompt('ราคาใหม่ (บาท)', String(value));
            if (next == null) return;
            const parsed = Number(next);
            if (Number.isNaN(parsed)) return;
            await updatePrivatePrice(row.id, { private_selling_price: parsed });
            await load();
          }}
        >
          {__uiText("฿")}{Number(value).toLocaleString()}
        </button>
      ),
    },
    {
      key: 'start_date',
      label: __uiText("เริ่ม"),
      render: (value, row) => (
        <input
          type="date"
          aria-label={__uiText("วันที่เริ่มต้นราคาพิเศษของ {0}", {"0": row.sku})}
          value={String(value ?? '')}
          onChange={async (e) => {
            const next = e.target.value;
            if (!next) return;
            await updatePrivatePrice(row.id, { start_date: next });
            await load();
          }}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
        />
      ),
    },
    {
      key: 'end_date',
      label: __uiText("สิ้นสุด"),
      render: (value, row) => (
        <input
          type="date"
          aria-label={__uiText("วันที่สิ้นสุดราคาพิเศษของ {0}", {"0": row.sku})}
          value={value ? String(value) : ''}
          min={row.start_date}
          onChange={async (e) => {
            await updatePrivatePrice(row.id, {
              end_date: e.target.value || undefined,
            });
            await load();
          }}
          className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700"
        />
      ),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: PrivatePriceListItem['status']) => (
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[value]}`}
        >
          {STATUS_LABELS[value]}
        </span>
      ),
    },
    {
      key: 'id',
      label: '',
      render: (_, row) => (
        <button
          type="button"
          className="text-xs text-red-600 hover:underline"
          onClick={async () => {
            if (!window.confirm(__uiText("ลบราคาพิเศษนี้?"))) return;
            await deletePrivatePrice(row.id);
            await load();
          }}
        >
          {__uiText("ลบ")}</button>
      ),
    },
  ];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-gray-500">
        {__uiText("ราคาพิเศษระดับบริษัท (Customer SKU) — เว้นสาขา = ใช้ทุกสาขาของบริษัทนี้")}</p>

      {error && <p className="text-sm text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-gray-500">
          {__uiText("นำเข้า CSV (SKU, price, start_date, end_date)")}<input
            type="file"
            accept=".csv"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              void handleImport(file);
              e.target.value = '';
            }}
            className="text-sm"
          />
        </label>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => void handleBulkDelete()}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {__uiText("ลบที่เลือก (")}{selectedIds.length})
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr_auto]"
      >
        <Input
          label={__uiText("รหัสสินค้า (SKU)")}
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
        />
        <Input
          label={__uiText("ราคาพิเศษ (บาท)")}
          type="number"
          value={form.price}
          onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
        />
        <Select
          label={__uiText("สาขา")}
          value={form.branch_id}
          onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))}
        >
          <option value="">{__uiText("ทุกสาขา (company-wide)")}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <DateRangeInput
          label={__uiText("ช่วงวันที่มีผล")}
          startDate={form.start_date}
          endDate={form.end_date}
          onStartDateChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
          onEndDateChange={(v) => setForm((f) => ({ ...f, end_date: v }))}
          className="h-10"
        />
        <button
          type="submit"
          disabled={saving}
          className="h-10 self-end rounded-lg bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? __uiText("กำลังบันทึก...") : __uiText("เพิ่มราคา")}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">{__uiText("ยังไม่มีราคาพิเศษสำหรับบริษัทนี้")}</p>
      ) : (
        <Table columns={columns} data={rows} idKey="id" />
      )}
    </div>
  );
}

export default CompanySpecialPricingPanel;
